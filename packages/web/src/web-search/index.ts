/**
 * Model-facing `web_search` tool. Owns the schema, parameter bounds, source
 * normalization, and rendering; provider details stay behind `ctx.web`.
 *
 * Results are discovery aids: the tool never fetches a result page itself.
 *
 * @module @micro-harness/web/web-search
 */

import type { ContentBlock } from '@micro-harness/core/llm'
import type { ToolDefinition, ToolExecutionContext } from '@micro-harness/core/tools'
import { WebError } from '../index.ts'
import type { WebSearchProvider, WebSearchSource } from '../index.ts'

/** Documented Search API limit for one query. */
const QUERY_MAX_CHARS = 128

/** Documented Search API upper bound for one response. */
const RESULT_MAX_COUNT = 50

/** Default source count when deployment configuration omits one. */
const DEFAULT_MAX_RESULTS = 8

/** Default cooperative timeout for one search. */
const DEFAULT_TIMEOUT_MS = 60_000

/** Default rendered snippet length. */
const DEFAULT_SNIPPET_MAX_CHARS = 400

/** Model-visible `web_search` arguments. */
export interface WebSearchArgs {
  readonly query: string
  readonly maxResults?: number
}

/** Canonical `web_search` result stored in the session. */
export interface WebSearchValue {
  readonly query: string
  readonly sources: readonly WebSearchSource[]
}

/** Tool construction options supplied by deployment composition. */
export interface WebSearchToolConfig {
  /** Provider used for every call. */
  readonly provider: WebSearchProvider
  /** Deployment cap on returned sources, clamped to `1..50`. Defaults to 8. */
  readonly maxResults?: number
  /** Cooperative timeout in milliseconds. Defaults to 60 s. */
  readonly timeoutMs?: number
  /** Rendered snippet cap in characters. Defaults to 400. */
  readonly snippetMaxChars?: number
}

/** Invalid model arguments; the executor converts this into an error result. */
export class WebSearchArgsError extends Error {
  readonly code = 'INVALID_ARGS'

  constructor(message: string) {
    super(message)
    this.name = 'WebSearchArgsError'
  }
}

/**
 * Build the `web_search` tool definition.
 * @param config - provider and deployment bounds.
 * @returns a registry-ready tool definition.
 */
export function createWebSearchTool(config: WebSearchToolConfig): ToolDefinition<WebSearchArgs, WebSearchValue> {
  const maxResultsLimit = clamp(config.maxResults ?? DEFAULT_MAX_RESULTS, 1, RESULT_MAX_COUNT)
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const snippetMaxChars = config.snippetMaxChars ?? DEFAULT_SNIPPET_MAX_CHARS

  return {
    name: 'web_search',
    description:
      'Search the public web and return source titles, URLs, and snippets. '
      + 'Results are discovery aids, not evidence; fetch a source before citing it.',
    parameters: {
      query: {
        type: 'string',
        description: 'Search query. Use concise keywords, not a full question.',
        required: true,
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of sources to return.',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                snippet: { type: 'string' },
              },
            },
          },
        },
      },
      render(_args, value): readonly ContentBlock[] {
        return [{ type: 'text', text: renderWebSearch(value, snippetMaxChars) }]
      },
    },
    timeoutMs,
    isConcurrencySafe: true,
    async execute(args: WebSearchArgs, execution: ToolExecutionContext): Promise<WebSearchValue> {
      const query = normalizeQuery(args.query)
      const maxResults = normalizeMaxResults(args.maxResults, maxResultsLimit)

      if (!config.provider.available()) {
        throw new WebError('WEB_PROVIDER_UNAVAILABLE', `search provider "${config.provider.id}" is unavailable`)
      }

      const timeout = AbortSignal.timeout(timeoutMs)
      const signal = AbortSignal.any([execution.signal, timeout])

      let result
      try {
        result = await config.provider.search({ query, maxResults }, signal)
      } catch (cause: unknown) {
        if (execution.signal.aborted) throw cause
        if (timeout.aborted) {
          throw new WebError('WEB_TIMEOUT', `web_search timed out after ${timeoutMs} ms`, {
            retryable: true,
            cause,
          })
        }
        throw cause
      }

      const sources = normalizeSources(result.sources, maxResults)
      if (result.sources.length > 0 && sources.length === 0) {
        throw new WebError('WEB_BAD_RESPONSE', 'web_search provider returned only invalid sources')
      }
      return { query, sources }
    },
  }
}

/** Validate and trim the query against the Search API's 128-character bound. */
function normalizeQuery(value: unknown): string {
  if (typeof value !== 'string') {
    throw new WebSearchArgsError('web_search requires a string query')
  }
  const query = value.trim()
  if (query === '') {
    throw new WebSearchArgsError('web_search requires a non-empty query')
  }
  const length = [...query].length
  if (length > QUERY_MAX_CHARS) {
    throw new WebSearchArgsError(
      `web_search query must be at most ${QUERY_MAX_CHARS} characters, got ${length}`,
    )
  }
  return query
}

/** Apply the model's optional bound on top of the deployment cap. */
function normalizeMaxResults(value: unknown, limit: number): number {
  if (value === undefined) return limit
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new WebSearchArgsError('web_search maxResults must be an integer')
  }
  return clamp(value, 1, limit)
}

/** Keep only titled HTTP(S) sources and deduplicate by normalized URL. */
function normalizeSources(sources: readonly WebSearchSource[], limit: number): WebSearchSource[] {
  const seen = new Set<string>()
  const normalized: WebSearchSource[] = []

  for (const source of sources) {
    const title = typeof source.title === 'string' ? source.title.trim() : ''
    if (title === '' || typeof source.url !== 'string') continue

    let url: URL
    try {
      url = new URL(source.url)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue

    const key = normalizeUrl(url)
    if (seen.has(key)) continue
    seen.add(key)

    normalized.push({
      title,
      url: source.url,
      ...(source.snippet === undefined ? {} : { snippet: source.snippet }),
    })
    if (normalized.length >= limit) break
  }

  return normalized
}

/** Lowercase scheme/host, drop the fragment and default port, keep the query. */
function normalizeUrl(url: URL): string {
  const copy = new URL(url.href)
  copy.hash = ''
  if ((copy.protocol === 'http:' && copy.port === '80')
    || (copy.protocol === 'https:' && copy.port === '443')) {
    copy.port = ''
  }
  return copy.href
}

/** Deterministic model-facing text for one search result. */
function renderWebSearch(value: WebSearchValue, snippetMaxChars: number): string {
  const lines = [`Web search: "${value.query}"`]
  if (value.sources.length === 0) {
    lines.push('No results.')
    return lines.join('\n')
  }

  lines.push(`Sources: ${value.sources.length}`)
  value.sources.forEach((source, index) => {
    lines.push(`[${index + 1}] ${source.title}`)
    lines.push(`    ${source.url}`)
    const snippet = source.snippet?.trim()
    if (snippet !== undefined && snippet !== '') {
      lines.push(`    ${truncate(snippet, snippetMaxChars)}`)
    }
  })
  lines.push('Search results are discovery aids. Fetch a source before citing it.')
  return lines.join('\n')
}

/** Clamp a number to an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Truncate by Unicode code points and mark the cut. */
function truncate(value: string, max: number): string {
  const chars = [...value]
  return chars.length <= max ? value : `${chars.slice(0, max).join('')}…`
}
