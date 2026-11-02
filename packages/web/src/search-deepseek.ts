/**
 * DeepSeek-backed search provider for `ctx.web`.
 *
 * Skeleton status: plugin metadata and config only.
 *
 * @module @micro-harness/web/search-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from './index.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-deepseek'

/** Register into the web seam. */
export const inject: string[] = ['web']

/** Search provider configuration. */
export interface Config {
  /** Literal API key; prefer `apiKeyEnv` outside local development. */
  readonly apiKey?: string
  /** Environment variable holding the API key. Defaults to `DEEPSEEK_API_KEY`. */
  readonly apiKeyEnv?: string
  /** API base URL. Defaults to `https://api.deepseek.com`. */
  readonly baseURL?: string
  /** Search model. Defaults to the provider's official search model. */
  readonly model?: string
  /** Provider API version header value. */
  readonly apiVersion?: string
  /** Output-token ceiling for one search synthesis. */
  readonly maxTokens?: number
  /** Provider-side cap on tool uses per query. */
  readonly maxUses?: number
}

/**
 * Register the DeepSeek search provider.
 * @param ctx - plugin context.
 * @param config - credentials and bounds.
 */
export function apply(ctx: Context, config: Config = {}): void {
  void ctx
  void config
  // TODO(skeleton): ctx.web.registerSearchProvider(new DeepSeekSearchProvider(config))
}
