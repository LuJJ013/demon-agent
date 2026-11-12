/**
 * Offline test for the Exa search provider.
 *
 * A local HTTP stub implements `POST /search` with the documented response
 * envelope, so no API key or external network is needed.
 *
 * Run explicitly:
 *
 *   ./.local/node/bin/node --import tsx --test tests/web-search-exa.spec.ts
 */

import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'
import { WebError } from '../packages/web/src/index.ts'
import { ExaSearchProvider } from '../packages/web/src/search-exa.ts'
import { createWebSearchTool } from '../packages/web/src/web-search/index.ts'
import type { WebSearchArgs, WebSearchValue } from '../packages/web/src/web-search/index.ts'

interface Captured {
  readonly headers: IncomingHttpHeaders
  readonly body: Record<string, unknown>
}

const captured: Captured[] = []

const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || request.url !== '/search') {
      response.writeHead(404).end()
      return
    }

    const body = await readJson(request) as Record<string, unknown>
    captured.push({ headers: request.headers, body })

    if (body.query === 'server-error') {
      sendJson(response, 500, { requestId: 'req-1', error: 'upstream exploded', tag: 'INTERNAL_ERROR' })
      return
    }
    if (body.query === 'quota') {
      sendJson(response, 402, { requestId: 'req-2', error: 'no credits', tag: 'NOT_ENOUGH_CREDITS' })
      return
    }
    if (body.query === 'empty') {
      sendJson(response, 200, { requestId: 'req-3', results: [] })
      return
    }
    if (body.query === 'invalid') {
      sendJson(response, 200, { requestId: 'req-4', results: [{ title: 'No URL' }] })
      return
    }

    sendJson(response, 200, {
      requestId: 'req-5',
      resolvedSearchType: 'auto',
      results: [
        {
          id: 'https://example.com/cordis',
          title: 'Cordis',
          url: 'https://example.com/cordis',
          publishedDate: '2025-01-01T00:00:00.000Z',
          highlights: ['A plugin framework.', 'Second highlight'],
        },
        {
          id: 'https://example.com/summary',
          title: 'Summary only',
          url: 'https://example.com/summary',
          summary: 'Query-relevant summary.',
        },
        {
          id: 'https://example.com/text',
          title: 'Text only',
          url: 'https://example.com/text',
          text: 'x'.repeat(1_000),
        },
        {
          id: 'https://example.com/blank',
          title: 'No snippet',
          url: 'https://example.com/blank',
          highlights: ['   '],
        },
      ],
      searchTime: 0.1,
      costDollars: { total: 0.001 },
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

test('exa maps highlights, summary, and text into snippets', async () => {
  const tool = makeTool()
  const args: WebSearchArgs = { query: 'cordis', maxResults: 4 }

  const value = await tool.execute(args, context())

  assert.deepEqual(
    value.sources.map(source => [source.title, source.snippet]),
    [
      ['Cordis', 'A plugin framework.'],
      ['Summary only', 'Query-relevant summary.'],
      ['Text only', `${'x'.repeat(400)}…`],
      ['No snippet', undefined],
    ],
  )

  const sent = captured.at(-1)
  assert.equal(sent?.headers.authorization, 'Bearer exa-test-key')
  assert.deepEqual(sent?.body, {
    query: 'cordis',
    type: 'auto',
    numResults: 4,
    contents: { highlights: { maxCharacters: 400 } },
  })

  const text = render(tool, args, value)
  assert.match(text, /Web search: "cordis"/)
  assert.match(text, /Sources: 4/)
  assert.match(text, /\[1\] Cordis/)
  assert.match(text, /A plugin framework\./)
})

test('exa sends configured domain filters and search mode', async () => {
  const provider = new ExaSearchProvider({
    baseURL,
    apiKey: 'exa-test-key',
    type: 'deep-lite',
    numResults: 3,
    highlights: false,
    includeDomains: ['example.com'],
    excludeDomains: ['spam.example.com'],
    startPublishedDate: '2024-01-01T00:00:00.000Z',
    endPublishedDate: '2025-01-01T00:00:00.000Z',
    timeoutMs: 5_000,
  })
  await createWebSearchTool({ provider }).execute({ query: 'cordis', maxResults: 3 }, context())

  const sent = captured.at(-1)
  assert.deepEqual(sent?.body, {
    query: 'cordis',
    type: 'deep-lite',
    numResults: 3,
    includeDomains: ['example.com'],
    excludeDomains: ['spam.example.com'],
    startPublishedDate: '2024-01-01T00:00:00.000Z',
    endPublishedDate: '2025-01-01T00:00:00.000Z',
  })
})

test('exa returns an empty result without inventing sources', async () => {
  const tool = makeTool()
  const args: WebSearchArgs = { query: 'empty' }

  const value = await tool.execute(args, context())

  assert.deepEqual(value.sources, [])
  assert.match(render(tool, args, value), /No results\./)
})

test('exa rejects a malformed result entry', async () => {
  await assert.rejects(
    makeTool().execute({ query: 'invalid' }, context()),
    (error: unknown) => error instanceof WebError && error.code === 'WEB_BAD_RESPONSE',
  )
})

test('exa marks 5xx failures retryable', async () => {
  await assert.rejects(
    makeTool().execute({ query: 'server-error' }, context()),
    (error: unknown) => error instanceof WebError
      && error.code === 'WEB_SEARCH_FAILED'
      && error.retryable,
  )
})

test('exa maps 402 to a non-retryable quota error', async () => {
  await assert.rejects(
    makeTool().execute({ query: 'quota' }, context()),
    (error: unknown) => error instanceof WebError
      && error.code === 'WEB_PROVIDER_QUOTA'
      && !error.retryable,
  )
})

test('exa reports a missing credential', async () => {
  const provider = new ExaSearchProvider({ apiKey: '', apiKeyEnv: 'WEB_SEARCH_TEST_MISSING_EXA_KEY' })
  assert.equal(provider.available(), false)

  await assert.rejects(
    createWebSearchTool({ provider }).execute({ query: 'cordis' }, context()),
    (error: unknown) => error instanceof WebError && error.code === 'WEB_PROVIDER_UNAVAILABLE',
  )
})

/** Build a tool backed by the local stub. */
function makeTool() {
  const provider = new ExaSearchProvider({ baseURL, apiKey: 'exa-test-key', timeoutMs: 5_000 })
  return createWebSearchTool({ provider })
}

/** Minimal execution context for a direct tool call. */
function context(): { callId: string; signal: AbortSignal } {
  return { callId: 'test-web-search-exa', signal: AbortSignal.timeout(5_000) }
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
