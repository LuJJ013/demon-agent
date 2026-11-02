/**
 * DeepSeek adapter for `ctx.llm`. Owns HTTP transport, request translation,
 * streaming, and DeepSeek-specific error mapping.
 *
 * Skeleton status: plugin metadata and config only.
 *
 * @module @micro-harness/llm-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@micro-harness/core/llm'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'llm-deepseek'

/** Wait for the model access seam before registering the adapter. */
export const inject: string[] = ['llm']

/** DeepSeek adapter configuration. */
export interface Config {
  /** Environment variable holding the API key. Defaults to `DEEPSEEK_API_KEY`. */
  readonly apiKeyEnv?: string
  /** Messages endpoint base URL. Defaults to `https://api.deepseek.com`. */
  readonly baseURL?: string
  /** Model used when the agent does not select one. */
  readonly defaultModel?: string
}

/**
 * Register the DeepSeek adapter with `ctx.llm`.
 * @param ctx - plugin context.
 * @param config - API key source, endpoint, and default model.
 */
export function apply(ctx: Context, config: Config = {}): void {
  void ctx
  void config
  // TODO(skeleton): ctx.llm.registerAdapter(new DeepSeekAdapter(config))
}
