/**
 * Local Exa Search API stub for manual CLI checks. It implements `POST /search`
 * with canned results and never touches the network.
 *
 *   PORT=8788 node --import tsx tests/support/exa-stub.ts
 *   EXA_BASE_URL=http://127.0.0.1:8788 EXA_API_KEY=local \
 *     pnpm mh web-search "cordis plugins"
 */

import { createServer, type IncomingMessage } from 'node:http'

const port = Number(process.env.PORT ?? 8788)

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/search') {
    response.writeHead(404).end()
    return
  }

  try {
    const body = await readJson(request) as { query?: unknown; numResults?: unknown }
    const query = typeof body.query === 'string' ? body.query : ''
    const numResults = typeof body.numResults === 'number' ? body.numResults : 10
    process.stdout.write(`exa-stub: query=${JSON.stringify(query)}\n`)

    const results = [
      {
        id: `exa-${encodeURIComponent(query)}`,
        title: `Exa stub result for ${query}`,
        url: `https://example.com/exa?q=${encodeURIComponent(query)}`,
        highlights: [`A query-relevant highlight for "${query}" from the local Exa stub.`],
      },
      {
        id: 'exa-cordis',
        title: 'Cordis documentation',
        url: 'https://example.com/cordis',
        summary: 'Cordis composes services and plugins through a context tree.',
      },
      {
        id: 'exa-exa',
        title: 'Exa Search API',
        url: 'https://docs.exa.ai/reference/search',
        highlights: ['Search the web with embeddings and return page contents.'],
      },
    ].slice(0, numResults)

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ requestId: 'stub-request', results }))
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ requestId: 'stub-request', error: String(error), tag: 'INTERNAL_ERROR' }))
  }
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`exa-stub: listening on http://127.0.0.1:${port}/search\n`)
})

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
