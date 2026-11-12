/**
 * Offline test for the `web_search` tool and the DeepSeek Search provider.
 *
 * A local HTTP stub implements `POST /v1/tools/search` with the documented
 * response envelope, so no API key or external network is needed.
 *
 * Run explicitly:
 *
 *   ./.local/node/bin/node --import tsx --test tests/web-search.spec.ts
 */

import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'
import { WebError } from '../packages/web/src/index.ts'
import { DeepSeekSearchProvider } from '../packages/web/src/search-deepseek.ts'
import { createWebSearchTool, WebSearchArgsError } from '../packages/web/src/web-search/index.ts'
import type { WebSearchArgs, WebSearchValue } from '../packages/web/src/web-search/index.ts'

interface Captured {
  readonly headers: IncomingHttpHeaders
  readonly body: Record<string, unknown>
}

const captured: Captured[] = []

const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || request.url !== '/v1/tools/search') {
      response.writeHead(404).end()
      return
    }

    const body = await readJson(request) as Record<string, unknown>
    captured.push({ headers: request.headers, body })

    if (body.query === 'server-error') {
      sendJson(response, 500, {
        error: { message: 'upstream exploded', type: 'server_error', param: null, code: 'server_error' },
      })
      return
    }
    if (body.query === 'empty') {
      sendJson(response, 200, { results: [] })
      return
    }
    if (body.query === 'invalid') {
      sendJson(response, 200, { results: [{ title: '', url: 'ftp://example.com/x', snippet: 'x' }] })
      return
    }

    sendJson(response, 200, {
      results: [
        { title: 'Cordis', url: 'https://example.com/cordis', snippet: 'A plugin framework.' },
        { title: 'Cordis duplicate', url: 'https://EXAMPLE.com/cordis#section', snippet: 'dup' },
        { title: 'FTP', url: 'ftp://example.com/file' },
        { title: 'DeepSeek Harness', url: 'https://example.com/harness', snippet: 'Harness.' },
      ],
    })
  } catch (error) {
    response.writeHead(500).end(String(error))
  }
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address() as AddressInfo
const baseURL = `http://127.0.0.1:${port}`

after(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('web_search normalizes, deduplicates, and renders DeepSeek results', async () => {
  const tool = makeTool({ maxResults: 2 })
  const args: WebSearchArgs = { query: '  cordis  ', maxResults: 99 }

  const value = await tool.execute(args, context())

  assert.equal(value.query, 'cordis')
  assert.deepEqual(
    value.sources.map(source => source.url),
    ['https://example.com/cordis', 'https://example.com/harness'],
  )

  const text = render(tool, args, value)
  assert.match(text, /Web search: "cordis"/)
  assert.match(text, /Sources: 2/)
  assert.match(text, /\[1\] Cordis/)
  assert.match(text, /\[2\] DeepSeek Harness/)
  assert.match(text, /discovery aids/)

  const sent = captured.at(-1)
  assert.equal(sent?.headers.authorization, 'Bearer test-key')
  assert.deepEqual(sent?.body, { query: 'cordis', count: 2, need_content: false })
})

test('web_search renders an explicit empty result', async () => {
  const tool = makeTool()
  const args: WebSearchArgs = { query: 'empty' }

  const value = await tool.execute(args, context())

  assert.deepEqual(value.sources, [])
  assert.match(render(tool, args, value), /No results\./)
})

test('web_search rejects a response whose sources are all unusable', async () => {
  const tool = makeTool()

  await assert.rejects(
    tool.execute({ query: 'invalid' }, context()),
    (error: unknown) => error instanceof WebError && error.code === 'WEB_BAD_RESPONSE',
  )
})

test('web_search marks 5xx failures retryable', async () => {
  const tool = makeTool()

  await assert.rejects(
    tool.execute({ query: 'server-error' }, context()),
    (error: unknown) => error instanceof WebError
      && error.code === 'WEB_SEARCH_FAILED'
      && error.retryable,
  )
})

test('web_search rejects invalid arguments before calling the provider', async () => {
  const tool = makeTool()

  await assert.rejects(
    tool.execute({ query: '   ' }, context()),
    (error: unknown) => error instanceof WebSearchArgsError,
  )
  await assert.rejects(
    tool.execute({ query: 'x'.repeat(129) }, context()),
    (error: unknown) => error instanceof WebSearchArgsError,
  )
})

test('web_search reports a missing provider credential', async () => {
  const provider = new DeepSeekSearchProvider({ apiKey: '', apiKeyEnv: 'WEB_SEARCH_TEST_MISSING_KEY' })
  assert.equal(provider.available(), false)

  const tool = createWebSearchTool({ provider })
  await assert.rejects(
    tool.execute({ query: 'cordis' }, context()),
    (error: unknown) => error instanceof WebError && error.code === 'WEB_PROVIDER_UNAVAILABLE',
  )
})

/** Build a tool backed by the local stub. */
function makeTool(options: { readonly maxResults?: number } = {}) {
  const provider = new DeepSeekSearchProvider({ baseURL, apiKey: 'test-key', timeoutMs: 5_000 })
  return createWebSearchTool({
    provider,
    ...(options.maxResults === undefined ? {} : { maxResults: options.maxResults }),
  })
}

/** Minimal execution context for a direct tool call. */
function context(): { callId: string; signal: AbortSignal } {
  return { callId: 'test-web-search', signal: AbortSignal.timeout(5_000) }
}

/** Flatten the tool's model-facing blocks for assertions. */
function render(
  tool: ReturnType<typeof createWebSearchTool>,
  args: WebSearchArgs,
  value: WebSearchValue,
): string {
  return tool.output.render(args, value)
    .map(block => block.type === 'text' ? block.text : '')
    .join('\n')
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}
