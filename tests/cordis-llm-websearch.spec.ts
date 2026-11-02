/**
 * Minimal Cordis integration test: an LLM request decides to call a
 * `web_search` tool, the result is fed back, and the model returns an answer.
 *
 * The test is hermetic. A local HTTP server implements the two endpoints the
 * agent talks to:
 *
 *   POST /chat/completions  OpenAI-compatible chat completion
 *   GET  /search?q=...      search provider returning canned sources
 *
 * No API key or external network is needed. Swapping `baseURL` for the real
 * DeepSeek endpoint and replacing `Search` with a live provider turns this
 * into an integration probe.
 *
 * Run explicitly (the project does not run the whole suite by default):
 *
 *   ./.local/node/bin/node --import tsx --test tests/cordis-llm-websearch.spec.ts
 */

import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'

type Role = 'system' | 'user' | 'assistant' | 'tool'

interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface ChatMessage {
  role: Role
  content: string | null
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: ToolSchema[]
}

interface ChatResponse {
  choices: Array<{
    message: ChatMessage
    finish_reason: 'stop' | 'tool_calls'
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

interface SearchResult {
  title: string
  url: string
  snippet: string
}

interface SearchResponse {
  results: SearchResult[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    // `ctx.llm` is already declared by the core skeleton, so this test uses a
    // distinct key and defines its own minimal client.
    llmClient: Llm
    search: Search
    agent: Agent
  }

  interface Events {
    'agent/search'(query: string, results: SearchResult[]): void
    'agent/reply'(content: string): void
  }
}

interface LlmConfig {
  baseURL: string
}

/**
 * Chat-completions client. The wire shape is deliberately close to DeepSeek's
 * OpenAI-compatible API; only the transport is exercised by this test.
 */
class Llm extends Service {
  private baseURL: string

  constructor(ctx: Context, config: LlmConfig) {
    super(ctx, 'llmClient')
    this.baseURL = config.baseURL
  }

  async complete(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatMessage> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'fake-deepseek',
        messages,
        tools,
      } satisfies ChatRequest),
    })

    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
    const data = await response.json() as ChatResponse
    const choice = data.choices[0]
    if (!choice) throw new Error('LLM returned no choices')
    return choice.message
  }
}

interface SearchConfig {
  baseURL: string
}

/** Search provider stub; a real provider would call DeepSeek or another API. */
class Search extends Service {
  private baseURL: string

  constructor(ctx: Context, config: SearchConfig) {
    super(ctx, 'search')
    this.baseURL = config.baseURL
  }

  async search(query: string): Promise<SearchResult[]> {
    const url = new URL('/search', this.baseURL)
    url.searchParams.set('q', query)

    const response = await fetch(url)
    if (!response.ok) throw new Error(`search HTTP ${response.status}`)
    const data = await response.json() as SearchResponse
    return data.results
  }
}

/**
 * Minimal agent loop: one tool round, then a final model answer. It depends on
 * both services through `static inject`, so Cordis starts it only when both are
 * available and unloads it when either disappears.
 */
class Agent extends Service {
  static inject = ['llmClient', 'search']

  constructor(ctx: Context) {
    super(ctx, 'agent')
  }

  async run(question: string): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Use web_search before answering.' },
      { role: 'user', content: question },
    ]

    const tools: ToolSchema[] = [{
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web and return sources.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    }]

    const first = await this.ctx.llmClient.complete(messages, tools)
    messages.push(first)

    for (const call of first.tool_calls ?? []) {
      if (call.function.name !== 'web_search') continue

      const args = JSON.parse(call.function.arguments) as { query?: string }
      if (!args.query) throw new Error('web_search requires a query')

      const results = await this.ctx.search.search(args.query)
      this.ctx.emit('agent/search', args.query, results)
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(results),
      })
    }

    const final = await this.ctx.llmClient.complete(messages, tools)
    const content = final.content ?? ''
    this.ctx.emit('agent/reply', content)
    return content
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

test('cordis agent performs an LLM request and a web search', async (t) => {
  const chatRequests: ChatRequest[] = []
  const searchQueries: string[] = []

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'POST' && request.url === '/chat/completions') {
        const body = await readJson(request) as ChatRequest
        chatRequests.push(body)

        const hasToolResult = body.messages.some(message => message.role === 'tool')
        if (!hasToolResult) {
          sendJson(response, {
            choices: [{
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'web_search',
                    arguments: JSON.stringify({ query: 'Cordis plugin framework' }),
                  },
                }],
              },
              finish_reason: 'tool_calls',
            }],
            usage: { prompt_tokens: 12, completion_tokens: 6 },
          } satisfies ChatResponse)
        } else {
          sendJson(response, {
            choices: [{
              message: {
                role: 'assistant',
                content: 'Cordis is a plugin framework. See example.com.',
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 24, completion_tokens: 10 },
          } satisfies ChatResponse)
        }
        return
      }

      if (request.method === 'GET' && request.url?.startsWith('/search')) {
        const url = new URL(request.url, 'http://localhost')
        const query = url.searchParams.get('q') ?? ''
        searchQueries.push(query)
        sendJson(response, {
          results: [{
            title: 'Cordis',
            url: 'https://example.com/cordis',
            snippet: 'A plugin framework.',
          }],
        } satisfies SearchResponse)
        return
      }

      response.writeHead(404).end()
    } catch (error) {
      response.writeHead(500).end(String(error))
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const baseURL = `http://127.0.0.1:${port}`

  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const root = new Context()
  const searchEvents: string[] = []
  root.on('agent/search', (query) => searchEvents.push(query))

  // Start the agent before its dependencies: Cordis keeps it PENDING.
  const agentFiber = root.plugin(Agent)
  assert.equal(root.get('agent'), undefined)

  await root.plugin(Llm, { baseURL })
  await root.plugin(Search, { baseURL })
  await agentFiber.await()
  assert.ok(root.get('agent'))

  const answer = await root.agent.run('What is Cordis?')

  assert.match(answer, /plugin framework/)
  assert.deepEqual(searchEvents, ['Cordis plugin framework'])
  assert.equal(chatRequests.length, 2)
  assert.equal(chatRequests[0]?.tools?.[0]?.function.name, 'web_search')
  assert.ok(chatRequests[1]?.messages.some(message => message.role === 'tool'))
  assert.deepEqual(searchQueries, ['Cordis plugin framework'])

  // The service is owned by the agent fiber; disposing it removes `ctx.agent`.
  await agentFiber.dispose()
  assert.equal(root.get('agent'), undefined)
})
