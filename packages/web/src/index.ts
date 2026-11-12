/**
 * Web access seam (`ctx.web`). Owns provider registration and execution-time
 * provider selection. It never performs I/O itself.
 *
 * @module @micro-harness/web
 */

import { Service, type Context } from '@deepseek-ai/cordis'

/** One search request. */
export interface WebSearchRequest {
  readonly query: string
  readonly maxResults?: number
}

/** One search source. */
export interface WebSearchSource {
  readonly title: string
  readonly url: string
  readonly snippet?: string
}

/** Search result. */
export interface WebSearchResult {
  readonly sources: readonly WebSearchSource[]
  /** Provider id that produced the result, filled by the router. */
  readonly provider?: string
}

/** One fetch request. */
export interface WebFetchRequest {
  readonly url: string
}

/** A fetched body, already classified by the provider. */
export type WebFetchBody =
  | { readonly kind: 'html'; readonly content: string }
  | { readonly kind: 'text'; readonly content: string }

/** Fetch result. */
export interface WebFetchResult {
  readonly url: string
  readonly finalUrl: string
  readonly status: number
  readonly body: WebFetchBody
}

/** Common provider metadata. */
export interface WebProvider {
  readonly id: string
  /** False when credentials or runtime prerequisites are missing. */
  available(): boolean
}

/** Search provider contract. */
export interface WebSearchProvider extends WebProvider {
  search(request: WebSearchRequest, signal: AbortSignal): Promise<WebSearchResult>
}

/** Fetch provider contract. */
export interface WebFetchProvider extends WebProvider {
  fetch(request: WebFetchRequest, signal: AbortSignal): Promise<WebFetchResult>
}

/** Stable failure codes returned by web providers and tool adapters. */
export type WebErrorCode =
  | 'WEB_PROVIDER_UNAVAILABLE'
  | 'WEB_PROVIDER_AMBIGUOUS'
  | 'WEB_INVALID_URL'
  | 'WEB_UNSUPPORTED_PROTOCOL'
  | 'WEB_BLOCKED_ADDRESS'
  | 'WEB_REDIRECT_LIMIT'
  | 'WEB_TIMEOUT'
  | 'WEB_HTTP_STATUS'
  | 'WEB_UNSUPPORTED_CONTENT_TYPE'
  | 'WEB_TOO_LARGE'
  | 'WEB_BAD_RESPONSE'
  | 'WEB_FETCH_FAILED'
  | 'WEB_SEARCH_FAILED'
  | 'WEB_PROVIDER_QUOTA'

/**
 * A normalized web failure. Messages are safe to show to the model: they name
 * the operation and provider id, never credentials or request headers.
 */
export class WebError extends Error {
  readonly code: WebErrorCode
  readonly retryable: boolean

  constructor(
    code: WebErrorCode,
    message: string,
    options: { readonly retryable?: boolean; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'WebError'
    this.code = code
    this.retryable = options.retryable ?? false
  }
}

/** Configuration for the web seam. */
export interface Config {
  /** Explicit primary search provider id. Omit to auto-select a single usable provider. */
  readonly searchProvider?: string
  /** Search provider ids tried, in order, when the primary is unavailable, fails, or returns no sources. */
  readonly searchFallback?: readonly string[]
  /** Fall back when the primary returns zero sources. Defaults to true. */
  readonly searchFallbackOnEmpty?: boolean
  /** Explicit fetch provider id. Omit to auto-select a single usable provider. */
  readonly fetchProvider?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Search and fetch provider registry. */
    web: WebRuntime
  }
}

/**
 * The web access service. Selection happens at execution time, so a settings
 * change applies to the next call without remounting providers.
 */
export class WebRuntime extends Service {
  private readonly options: Config
  private readonly searchProviders = new Map<string, WebSearchProvider>()
  private readonly fetchProviders = new Map<string, WebFetchProvider>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'web')
    this.options = config
  }

  /**
   * Register a search provider. The caller owns the returned disposer, usually
   * through `ctx.effect()`.
   * @param provider - provider instance identified by `provider.id`.
   * @returns the exact disposer that unregisters this provider.
   */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    if (this.searchProviders.has(provider.id)) {
      throw new Error(`search provider "${provider.id}" is already registered`)
    }
    this.searchProviders.set(provider.id, provider)
    return () => {
      if (this.searchProviders.get(provider.id) === provider) this.searchProviders.delete(provider.id)
    }
  }

  /**
   * Register a fetch provider. The caller owns the returned disposer, usually
   * through `ctx.effect()`.
   * @param provider - provider instance identified by `provider.id`.
   * @returns the exact disposer that unregisters this provider.
   */
  registerFetchProvider(provider: WebFetchProvider): () => void {
    if (this.fetchProviders.has(provider.id)) {
      throw new Error(`fetch provider "${provider.id}" is already registered`)
    }
    this.fetchProviders.set(provider.id, provider)
    return () => {
      if (this.fetchProviders.get(provider.id) === provider) this.fetchProviders.delete(provider.id)
    }
  }

  /**
   * Run one search through the configured primary provider and its fallbacks.
   * @param request - normalized query and result bound.
   * @param signal - caller cancellation.
   * @returns the first successful provider's sources.
   */
  async search(request: WebSearchRequest, signal: AbortSignal): Promise<WebSearchResult> {
    return searchWithFallback([...this.searchProviders.values()], request, signal, {
      ...(this.options.searchProvider === undefined ? {} : { primary: this.options.searchProvider }),
      ...(this.options.searchFallback === undefined ? {} : { fallback: this.options.searchFallback }),
      ...(this.options.searchFallbackOnEmpty === undefined
        ? {}
        : { fallbackOnEmpty: this.options.searchFallbackOnEmpty }),
    })
  }

  /**
   * Run one fetch through the configured or single available provider.
   * @param request - normalized URL.
   * @param signal - caller cancellation.
   * @returns the provider's classified body.
   */
  async fetch(request: WebFetchRequest, signal: AbortSignal): Promise<WebFetchResult> {
    return this.selectFetchProvider().fetch(request, signal)
  }

  private selectFetchProvider(): WebFetchProvider {
    const id = this.options.fetchProvider
    if (id !== undefined) return requireAvailable(this.fetchProviders.get(id), id, 'fetch')
    return selectSingle(available(this.fetchProviders), 'fetch')
  }
}

/** Search routing options shared by the service and standalone CLI use. */
export interface SearchRouterOptions {
  /** Primary provider id. Omit to require exactly one available provider. */
  readonly primary?: string
  /** Provider ids tried after the primary, in order. */
  readonly fallback?: readonly string[]
  /** Fall back when the primary returns zero sources. Defaults to true. */
  readonly fallbackOnEmpty?: boolean
}

/**
 * Build a `WebSearchProvider` that applies primary/fallback routing over a
 * fixed provider set. Useful for the CLI and tests without a Cordis context.
 * @param providers - registered provider instances.
 * @param options - primary/fallback policy.
 * @returns a provider-shaped router.
 */
export function createSearchRouter(
  providers: readonly WebSearchProvider[],
  options: SearchRouterOptions = {},
): WebSearchProvider {
  return {
    id: 'search-router',
    available: () => providers.some(provider => provider.available()),
    search: (request, signal) => searchWithFallback(providers, request, signal, options),
  }
}

/**
 * Try the primary provider, then fallbacks, returning the first non-empty
 * successful result. Policy errors (SSRF, invalid URL, robots) never fall back.
 * @param providers - candidate providers.
 * @param request - normalized search request.
 * @param signal - caller cancellation.
 * @param options - primary/fallback policy.
 * @returns the first successful result with `provider` set.
 */
export async function searchWithFallback(
  providers: readonly WebSearchProvider[],
  request: WebSearchRequest,
  signal: AbortSignal,
  options: SearchRouterOptions = {},
): Promise<WebSearchResult> {
  const order = resolveSearchOrder(providers, options)
  const byId = new Map(providers.map(provider => [provider.id, provider]))
  let lastError: unknown
  let attempted = false

  for (const [index, id] of order.entries()) {
    const provider = byId.get(id)
    if (provider === undefined || !provider.available()) {
      lastError = new WebError(
        'WEB_PROVIDER_UNAVAILABLE',
        `search provider "${id}" is not registered or unavailable`,
      )
      continue
    }

    attempted = true
    try {
      const result = await provider.search(request, signal)
      const isLast = index === order.length - 1
      if (result.sources.length > 0 || options.fallbackOnEmpty === false || isLast) {
        return { ...result, provider: id }
      }
    } catch (cause: unknown) {
      if (signal.aborted) throw cause
      if (!isFallbackEligible(cause)) throw cause
      lastError = cause
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new WebError(
    'WEB_PROVIDER_UNAVAILABLE',
    attempted ? 'no search provider returned a result' : 'no search provider is available',
  )
}

/** Resolve the ordered provider ids for one search. */
function resolveSearchOrder(
  providers: readonly WebSearchProvider[],
  options: SearchRouterOptions,
): string[] {
  const fallback = options.fallback ?? []
  if (options.primary !== undefined) return unique([options.primary, ...fallback])
  if (fallback.length > 0) return unique(fallback)

  const usable = providers.filter(provider => provider.available())
  const [only] = usable
  if (only === undefined) {
    throw new WebError('WEB_PROVIDER_UNAVAILABLE', 'no search provider is available')
  }
  if (usable.length > 1) {
    throw new WebError(
      'WEB_PROVIDER_AMBIGUOUS',
      'multiple search providers are available; configure searchProvider explicitly',
    )
  }
  return [only.id]
}

/** Policy failures must not be masked by a different provider. */
const NON_FALLBACK_CODES = new Set<WebErrorCode>([
  'WEB_INVALID_URL',
  'WEB_UNSUPPORTED_PROTOCOL',
  'WEB_BLOCKED_ADDRESS',
  'WEB_REDIRECT_LIMIT',
  'WEB_UNSUPPORTED_CONTENT_TYPE',
])

/** Whether another provider may be tried after this failure. */
function isFallbackEligible(error: unknown): boolean {
  return !(error instanceof WebError && NON_FALLBACK_CODES.has(error.code))
}

/** Preserve order while removing duplicate ids. */
function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/** Providers that report themselves usable. */
function available<T extends WebProvider>(providers: Map<string, T>): T[] {
  return [...providers.values()].filter(provider => provider.available())
}

/** Resolve an explicitly configured provider or fail without falling back. */
function requireAvailable<T extends WebProvider>(provider: T | undefined, id: string, kind: string): T {
  if (provider === undefined || !provider.available()) {
    throw new WebError(
      'WEB_PROVIDER_UNAVAILABLE',
      `${kind} provider "${id}" is not registered or unavailable`,
    )
  }
  return provider
}

/** Select the only usable provider; ambiguity is a deployment error. */
function selectSingle<T extends WebProvider>(providers: readonly T[], kind: string): T {
  const [only] = providers
  if (only === undefined) {
    throw new WebError('WEB_PROVIDER_UNAVAILABLE', `no ${kind} provider is available`)
  }
  if (providers.length > 1) {
    throw new WebError(
      'WEB_PROVIDER_AMBIGUOUS',
      `multiple ${kind} providers are available; configure ${kind}Provider explicitly`,
    )
  }
  return only
}

export default WebRuntime
