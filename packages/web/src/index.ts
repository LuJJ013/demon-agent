/**
 * Web access seam (`ctx.web`). Owns search/fetch provider registration and
 * execution-time provider selection. It never performs I/O itself.
 *
 * Skeleton status: the service key and provider types exist; registries,
 * selection rules, and typed errors are TODO.
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

/** Configuration for the web seam. */
export interface Config {
  /** Explicit search provider id. Omit to auto-select a single usable provider. */
  readonly searchProvider?: string
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
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'web')
    void config
    // TODO(skeleton): registerSearchProvider(), registerFetchProvider(),
    // search(), fetch(), and WebError codes.
  }
}

export default WebRuntime
