/**
 * DeepSeek-backed search provider for `ctx.web`. Calls DeepSeek's official
 * Search API (`POST /v1/tools/search`) and normalizes its response.
 *
 * @module @micro-harness/web/search-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import { WebError } from './index.ts'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from './index.ts'
import { isRecord, readErrorDetail, readLimited } from './provider-http.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-deepseek'

/** Register into the web seam. */
export const inject: string[] = ['web']

/** Provider id used by deployment configuration and logs. */
export const PROVIDER_ID = 'deepseek-official'

/** Documented bounds for one Search API request. */
const MAX_COUNT = 50
const MAX_RESPONSE_BYTES = 1024 * 1024

/** Search provider configuration. */
export interface Config {
  /** Literal API key; prefer `apiKeyEnv` outside local development. */
  readonly apiKey?: string
  /** Environment variable holding the API key. Defaults to `DEEPSEEK_API_KEY`. */
  readonly apiKeyEnv?: string
  /** API base URL. Defaults to `https://api.deepseek.com`. */
  readonly baseURL?: string
  /** Search endpoint path. Defaults to `/v1/tools/search`. */
  readonly path?: string
  /** Provider-side result count when the caller omits `maxResults`. Defaults to 10. */
  readonly count?: number
  /** Return page content in `content`. Defaults to false. */
  readonly needContent?: boolean
  /** Whole-request timeout in milliseconds. Defaults to 30 s. */
  readonly timeoutMs?: number
  /** Maximum response body bytes. Defaults to 1 MiB. */
  readonly maxResponseBytes?: number
}

/**
 * DeepSeek Search API provider. One attempt per call; retry classification is
 * exposed through `WebError.retryable` for the crawl layer.
 */
export class DeepSeekSearchProvider implements WebSearchProvider {
  readonly id = PROVIDER_ID
  private readonly apiKey: string | undefined
  private readonly baseURL: string
  private readonly path: string
  private readonly count: number
  private readonly needContent: boolean
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number

  constructor(config: Config = {}) {
    const envName = config.apiKeyEnv ?? 'DEEPSEEK_API_KEY'
    const key = (config.apiKey ?? process.env[envName])?.trim()
    this.apiKey = key === undefined || key === '' ? undefined : key
    this.baseURL = config.baseURL ?? 'https://api.deepseek.com'
    this.path = config.path ?? '/v1/tools/search'
    this.count = clampCount(config.count ?? 10)
    this.needContent = config.needContent ?? false
    this.timeoutMs = config.timeoutMs ?? 30_000
    this.maxResponseBytes = config.maxResponseBytes ?? MAX_RESPONSE_BYTES
  }

  /** Search is usable only when a non-empty API key is configured. */
  available(): boolean {
    return this.apiKey !== undefined
  }

  /**
   * Run one search request.
   * @param request - normalized query and optional result bound.
   * @param signal - caller cancellation.
   * @returns validated sources in provider order.
   */
  async search(request: WebSearchRequest, signal: AbortSignal): Promise<WebSearchResult> {
    const apiKey = this.apiKey
    if (apiKey === undefined) {
      throw new WebError(
        'WEB_PROVIDER_UNAVAILABLE',
        `search provider "${this.id}" is unavailable: configure a DeepSeek API key`,
      )
    }

    const url = new URL(this.path, this.baseURL)
    const body = {
      query: request.query,
      count: clampCount(request.maxResults ?? this.count),
      need_content: this.needContent,
    }
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = AbortSignal.any([signal, timeout])

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: combined,
      })
    } catch (cause: unknown) {
      if (signal.aborted) throw signal.reason
      if (timeout.aborted) {
        throw new WebError(
          'WEB_TIMEOUT',
          `search provider "${this.id}" timed out after ${this.timeoutMs} ms`,
          { retryable: true, cause },
        )
      }
      throw new WebError('WEB_SEARCH_FAILED', `search provider "${this.id}" request failed`, {
        retryable: true,
        cause,
      })
    }

    if (!response.ok) {
      const detail = await readErrorDetail(response)
      const retryable = response.status === 408 || response.status === 425
        || response.status === 429 || response.status >= 500
      throw new WebError(
        'WEB_SEARCH_FAILED',
        `search provider "${this.id}" returned HTTP ${response.status}${detail === undefined ? '' : `: ${detail}`}`,
        { retryable },
      )
    }

    const text = await readLimited(response, this.maxResponseBytes, this.id)
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch (cause: unknown) {
      throw new WebError('WEB_BAD_RESPONSE', `search provider "${this.id}" returned invalid JSON`, { cause })
    }
    return { sources: parseSources(payload, this.id) }
  }
}

/**
 * Register the DeepSeek search provider.
 * @param ctx - plugin context.
 * @param config - credentials and bounds.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new DeepSeekSearchProvider(config)
  ctx.effect(() => ctx.web.registerSearchProvider(provider))
}

/** Clamp a requested result count to the documented `1..50` range. */
function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 10
  return Math.min(MAX_COUNT, Math.max(1, Math.trunc(value)))
}

/** Validate the documented `{ results: [...] }` envelope. */
function parseSources(payload: unknown, providerId: string): WebSearchSource[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new WebError(
      'WEB_BAD_RESPONSE',
      `search provider "${providerId}" response is missing a results array`,
    )
  }
  return payload.results.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.title !== 'string' || typeof entry.url !== 'string'
      || (entry.snippet !== undefined && typeof entry.snippet !== 'string')) {
      throw new WebError(
        'WEB_BAD_RESPONSE',
        `search provider "${providerId}" returned a malformed result`,
      )
    }
    return {
      title: entry.title,
      url: entry.url,
      ...(entry.snippet === undefined ? {} : { snippet: entry.snippet }),
    }
  })
}

export default DeepSeekSearchProvider
