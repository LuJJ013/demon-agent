/**
 * Model-facing `web_search` / `web_fetch` tools over `ctx.web`. Owns schemas,
 * descriptions, limits, and rendering; never provider details.
 *
 * Skeleton status: plugin metadata and config only.
 *
 * @module @micro-harness/web/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@micro-harness/core/system-prompt'
import type {} from '@micro-harness/core/tools'
import type {} from './index.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-web'

/** Services required by the web tool suite. */
export const inject: string[] = ['tools', 'web', 'systemPrompt']

/** Web tool configuration. */
export interface Config {
  /** Register `web_search`. Defaults to true. */
  readonly search?: boolean
  /** Register `web_fetch`. Defaults to true. */
  readonly fetch?: boolean
  /** Upper bound on sources returned by one search. */
  readonly searchMaxResults?: number
  /** Upper bound on distinct provider queries per search call. */
  readonly searchMaxQueries?: number
  /** Cap on the provider's synthesized answer, in characters. */
  readonly searchSummaryMaxChars?: number
  /** Cooperative timeout budget per search call, in milliseconds. */
  readonly searchTimeoutMs?: number
  /** Cooperative timeout budget per fetch call, in milliseconds. */
  readonly fetchTimeoutMs?: number
  /** Cap on fetched output returned to the model, in characters. */
  readonly fetchMaxOutputChars?: number
}

/**
 * Register the enabled web tools.
 * @param ctx - plugin context.
 * @param config - enablement and bounds.
 */
export function apply(ctx: Context, config: Config = {}): void {
  void ctx
  void config
  // TODO(skeleton): register web_search and web_fetch via ctx.tools.register().
}
