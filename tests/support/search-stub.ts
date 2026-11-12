/**
 * Local DeepSeek Search API stub for manual CLI checks. It implements
 * `POST /v1/tools/search` with canned results and never touches the network.
 *
 *   PORT=8787 node --import tsx tests/support/search-stub.ts
 *   WEB_SEARCH_BASE_URL=http://127.0.0.1:8787 DEEPSEEK_API_KEY=local \
 *     pnpm mh web-search "cordis plugins"
 */

import { createServer, type IncomingMessage } from 'node:http'

const port = Number(process.env.PORT ?? 8787)

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/tools/search') {
    response.writeHead(404).end()
    return
  }

  try {
    const body = await readJson(request) as { query?: unknown; count?: unknown }
    const query = typeof body.query === 'string' ? body.query : ''
    const count = typeof body.count === 'number' ? body.count : 10
    process.stdout.write(`search-stub: query=${JSON.stringify(query)}\n`)

    const results = [
      {
        title: `Stub result for ${query}`,
        url: `https://example.com/stub?q=${encodeURIComponent(query)}`,
        snippet: `A canned result for "${query}" returned by the local stub.`,
      },
      {
        title: 'Cordis plugin framework',
        url: 'https://example.com/cordis',
        snippet: 'Cordis composes services and plugins through a Cordis context tree.',
      },
      {
        title: 'DeepSeek Search API',
        url: 'https://api-docs.deepseek.com/guides/search/',
        snippet: 'The official Search API returns structured web results for agents.',
      },
    ].slice(0, count)

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ results }))
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: String(error) } }))
  }
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`search-stub: listening on http://127.0.0.1:${port}/v1/tools/search\n`)
})

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
