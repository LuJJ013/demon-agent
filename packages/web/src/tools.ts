/**
 * Model-facing `web_search` / `web_fetch` tools over `ctx.web`. Owns schemas,
 * descriptions, limits, and rendering; never provider details.
 *
 * Skeleton status: `web_search` is implemented as a standalone definition;
 * registration waits for `ctx.tools.register()`.
 *
 * @module @micro-harness/web/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@micro-harness/core/system-prompt'
import type {} from '@micro-harness/core/tools'
import type {} from './index.ts'

export { createWebSearchTool, WebSearchArgsError } from './web-search/index.ts'
export type { WebSearchArgs, WebSearchValue, WebSearchToolConfig } from './web-search/index.ts'

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
  /** Cooperative timeout budget per search call, in milliseconds. */
  readonly searchTimeoutMs?: number
  /** Cooperative timeout budget per fetch call, in milliseconds. */
  readonly fetchTimeoutMs?: number
  /** Cap on fetched output returned to the model, in characters. */
  readonly fetchMaxOutputChars?: number
  /** Fetched-body rendering mode. Defaults to `text`. */
  readonly fetchFormat?: 'text' | 'html'
}

/**
 * Register the enabled web tools.
 * @param ctx - plugin context.
 * @param config - enablement and bounds.
 */
export function apply(ctx: Context, config: Config = {}): void {
  void ctx
  void config
  // TODO(skeleton): ctx.tools.register(createWebSearchTool({ provider: ctx.web, ... }))
  // after `ctx.tools` exposes registration and `ctx.web` exposes the selected provider.
}
