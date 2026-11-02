/**
 * HTTP fetch provider for `ctx.web`. Owns redirect policy, timeouts, byte and
 * character limits, content-type classification, and SSRF guards.
 *
 * Skeleton status: plugin metadata and config only.
 *
 * @module @micro-harness/web/fetch-http
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from './index.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fetch-http'

/** Register into the web seam. */
export const inject: string[] = ['web']

/** HTTP fetch limits. */
export interface Config {
  /** Maximum response body size in bytes. */
  readonly maxResponseBytes?: number
  /** Maximum decoded body length in characters. */
  readonly maxBodyChars?: number
  /** Whole-request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum redirects followed. */
  readonly maxRedirects?: number
  /** Explicit User-Agent. */
  readonly userAgent?: string
}

/**
 * Register the HTTP fetch provider.
 * @param ctx - plugin context.
 * @param config - transport limits.
 */
export function apply(ctx: Context, config: Config = {}): void {
  void ctx
  void config
  // TODO(skeleton): ctx.web.registerFetchProvider(new HttpFetchProvider(config))
}
