/**
 * Manual network probe as a spec: download one URL and write its body to an
 * HTML file under `tests/output/`, then report the file's path.
 *
 * The URL comes from `FETCH_URL`, so the ordinary offline suite skips this
 * test and never touches the network:
 *
 *   FETCH_URL=https://example.com pnpm test:fetch
 *   FETCH_URL=https://example.com pnpm test tests/fetch-url.spec.ts
 *
 * The provider inside the harness (`web/fetch-http`) still owns redirects,
 * limits, and SSRF policy. This probe only exercises the transport.
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Whole-request budget, matching `web/fetch-http`'s default. */
const TIMEOUT_MS = 30_000

/** Refuse to buffer more than the provider's default limit. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

/** Where downloaded pages are written; gitignored. */
const OUTPUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output')

/**
 * Validate the URL handed in by the caller.
 * @param raw - untrusted input.
 */
function parseHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`FETCH_URL is not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`FETCH_URL must be http/https, got ${url.protocol}`)
  }
  return url
}

/**
 * Build a stable, filesystem-safe file name for a URL. Query strings are
 * hashed so two variants of the same path do not overwrite each other.
 * @param url - parsed target.
 */
function outputName(url: URL): string {
  const host = url.host.replace(/[^a-zA-Z0-9.-]+/g, '_') || 'page'
  const path = decodeURIComponent(url.pathname)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    // Avoid `page.html.html`: the extension is added once, below.
    .replace(/\.html?$/i, '')
  const query = url.search
    ? `-${createHash('sha1').update(url.search).digest('hex').slice(0, 8)}`
    : ''
  return `${host}${path ? `-${path}` : ''}${query}.html`
}

/**
 * Read the response body, rejecting bodies over the size cap.
 * @param response - a live fetch response.
 */
async function readBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error(`response is ${declared} bytes, over the ${MAX_RESPONSE_BYTES}-byte limit`)
  }

  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error(`response exceeded the ${MAX_RESPONSE_BYTES}-byte limit`)
    }
    chunks.push(value)
  }

  return new TextDecoder().decode(Buffer.concat(chunks))
}

/**
 * Fetch one HTTP(S) URL and save its body as HTML.
 * @param url - parsed target.
 * @param outputDir - destination directory.
 * @returns absolute path of the written file.
 */
export async function fetchHtml(url: URL, outputDir = OUTPUT_DIR): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'user-agent': 'micro-harness-fetch-url/0.0.0',
    },
  })

  const contentType = response.headers.get('content-type') ?? '(none)'
  const body = await readBody(response)

  await mkdir(outputDir, { recursive: true })
  const file = join(outputDir, outputName(url))
  await writeFile(file, body)

  // The path is the point of this probe: write it straight to stdout so it
  // survives whichever reporter is active. `console.log` is swallowed by the
  // default reporter for passing tests.
  process.stdout.write(
    `\nfetch-url: ${response.status} ${response.statusText} ${response.url}` +
      `\nfetch-url: content-type: ${contentType}` +
      `\nfetch-url: html saved to: ${file}\n`,
  )

  expect(response.ok, `HTTP ${response.status} for ${url.href}`).toBe(true)
  expect(contentType).toMatch(/html|xml|text\/plain/i)
  expect(body.length).toBeGreaterThan(0)

  return file
}

describe('fetch-url', () => {
  const raw = process.env.FETCH_URL

  it.skipIf(!raw)(
    'downloads the page and reports the html path',
    async () => {
      // Guarded by skipIf, but keep the type narrow for the compiler.
      if (!raw) return
      const file = await fetchHtml(parseHttpUrl(raw))
      expect(file).toMatch(/\.html$/)
    },
    TIMEOUT_MS + 5_000,
  )
})
