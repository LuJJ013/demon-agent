/**
 * Exa-backed search provider for `ctx.web`. Calls Exa's Search API
 * (`POST /search`) and normalizes its response into `WebSearchSource[]`.
 *
 * Exa is optimized for natural-language queries and returns query-relevant
 * highlights, which are mapped to the model-facing `snippet` field.
 *
 * @module @micro-harness/web/search-exa
 */

import type { Context } from '@deepseek-ai/cordis'
import { WebError } from './index.ts'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from './index.ts'
import { isRecord, readErrorDetail, readLimited, truncate } from './provider-http.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-exa'

/** Register into the web seam. */
export const inject: string[] = ['web']

/** Provider id used by deployment configuration and logs. */
export const PROVIDER_ID = 'exa'

/** Documented bounds for one Exa search request. */
const MAX_RESULTS = 100
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_HIGHLIGHT_CHARS = 1_000_000

/** Supported Exa search modes. Legacy modes are accepted for compatibility. */
export type ExaSearchType =
  | 'auto'
  | 'lite'
  | 'deep-lite'
  | 'deep'
  | 'fast'
  | 'instant'
  | 'deep-reasoning'

/** Search provider configuration. */
export interface Config {
  /** Literal API key; prefer `apiKeyEnv` outside local development. */
  readonly apiKey?: string
  /** Environment variable holding the API key. Defaults to `EXA_API_KEY`. */
  readonly apiKeyEnv?: string
  /** API base URL. Defaults to `https://api.exa.ai`. */
  readonly baseURL?: string
  /** Search endpoint path. Defaults to `/search`. */
  readonly path?: string
  /** Exa search mode. Defaults to `auto`. */
  readonly type?: ExaSearchType
  /** Provider-side result count when the caller omits `maxResults`. Defaults to 10. */
  readonly numResults?: number
  /** Request query-relevant highlights and map them to snippets. Defaults to true. */
  readonly highlights?: boolean
  /** Per-result highlight character budget. Defaults to 400. */
  readonly highlightsMaxCharacters?: number
  /** Restrict results to these domains or path prefixes. */
  readonly includeDomains?: readonly string[]
  /** Exclude results from these domains or path prefixes. */
  readonly excludeDomains?: readonly string[]
  /** Only include pages published after this ISO 8601 timestamp. */
  readonly startPublishedDate?: string
  /** Only include pages published before this ISO 8601 timestamp. */
  readonly endPublishedDate?: string
  /** Whole-request timeout in milliseconds. Defaults to 30 s. */
  readonly timeoutMs?: number
  /** Maximum response body bytes. Defaults to 1 MiB. */
  readonly maxResponseBytes?: number
}

/**
 * Exa Search API provider. One attempt per call; retry classification is
 * exposed through `WebError.retryable` for the crawl/fallback layer.
 */
export class ExaSearchProvider implements WebSearchProvider {
  readonly id = PROVIDER_ID
  private readonly apiKey: string | undefined
  private readonly baseURL: string
  private readonly path: string
  private readonly type: ExaSearchType
  private readonly numResults: number
  private readonly highlights: boolean
  private readonly highlightsMaxCharacters: number
  private readonly includeDomains: readonly string[]
  private readonly excludeDomains: readonly string[]
  private readonly startPublishedDate: string | undefined
  private readonly endPublishedDate: string | undefined
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number

  constructor(config: Config = {}) {
    const envName = config.apiKeyEnv ?? 'EXA_API_KEY'
    const key = (config.apiKey ?? process.env[envName])?.trim()
    this.apiKey = key === undefined || key === '' ? undefined : key
    this.baseURL = config.baseURL ?? 'https://api.exa.ai'
    this.path = config.path ?? '/search'
    this.type = isExaSearchType(config.type) ? config.type : 'auto'
    this.numResults = clamp(config.numResults ?? 10, 1, MAX_RESULTS)
    this.highlights = config.highlights ?? true
    this.highlightsMaxCharacters = clamp(
      config.highlightsMaxCharacters ?? 400,
      1,
      MAX_HIGHLIGHT_CHARS,
    )
    this.includeDomains = config.includeDomains ?? []
    this.excludeDomains = config.excludeDomains ?? []
    this.startPublishedDate = config.startPublishedDate
    this.endPublishedDate = config.endPublishedDate
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
        `search provider "${this.id}" is unavailable: configure an Exa API key`,
      )
    }

    const url = new URL(this.path, this.baseURL)
    const body: Record<string, unknown> = {
      query: request.query,
      type: this.type,
      numResults: clamp(request.maxResults ?? this.numResults, 1, MAX_RESULTS),
    }
    if (this.highlights) {
      body.contents = {
        highlights: { maxCharacters: this.highlightsMaxCharacters },
      }
    }
    if (this.includeDomains.length > 0) body.includeDomains = [...this.includeDomains]
    if (this.excludeDomains.length > 0) body.excludeDomains = [...this.excludeDomains]
    if (this.startPublishedDate !== undefined) body.startPublishedDate = this.startPublishedDate
    if (this.endPublishedDate !== undefined) body.endPublishedDate = this.endPublishedDate

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
      const status = response.status
      const retryable = status === 408 || status === 425 || status === 429 || status >= 500
      const code = status === 402 ? 'WEB_PROVIDER_QUOTA' : 'WEB_SEARCH_FAILED'
      throw new WebError(
        code,
        `search provider "${this.id}" returned HTTP ${status}${detail === undefined ? '' : `: ${detail}`}`,
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
 * Register the Exa search provider.
 * @param ctx - plugin context.
 * @param config - credentials and bounds.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new ExaSearchProvider(config)
  ctx.effect(() => ctx.web.registerSearchProvider(provider))
}

/** Clamp a number to an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
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
    if (!isRecord(entry) || typeof entry.title !== 'string' || typeof entry.url !== 'string') {
      throw new WebError(
        'WEB_BAD_RESPONSE',
        `search provider "${providerId}" returned a malformed result`,
      )
    }
    const snippet = pickSnippet(entry)
    return {
      title: entry.title,
      url: entry.url,
      ...(snippet === undefined ? {} : { snippet }),
    }
  })
}

/** Prefer Exa highlights; fall back to summary or truncated text. */
function pickSnippet(entry: Record<string, unknown>): string | undefined {
  if (Array.isArray(entry.highlights)) {
    const highlight = entry.highlights.find(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    )
    if (highlight !== undefined) return highlight.trim()
  }
  if (typeof entry.summary === 'string' && entry.summary.trim() !== '') {
    return entry.summary.trim()
  }
  if (typeof entry.text === 'string' && entry.text.trim() !== '') {
    return truncate(entry.text.trim(), 400)
  }
  return undefined
}

/** Narrow a configured string to the Exa search-mode union. */
function isExaSearchType(value: unknown): value is ExaSearchType {
  return value === 'auto'
    || value === 'lite'
    || value === 'deep-lite'
    || value === 'deep'
    || value === 'fast'
    || value === 'instant'
    || value === 'deep-reasoning'
}

export default ExaSearchProvider
