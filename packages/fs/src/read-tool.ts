/**
 * Model-facing `read_file` tool over `ctx.fs`. Owns the schema, offset/limit
 * window, binary rejection, and numbered-line rendering; it never touches the
 * host filesystem directly.
 *
 * Skeleton status: plugin metadata and config only.
 *
 * @module @micro-harness/fs/read-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@micro-harness/core/system-prompt'
import type {} from '@micro-harness/core/tools'
import type {} from './index.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-fs-read'

/** Services required by the read tool. */
export const inject: string[] = ['tools', 'fs', 'systemPrompt']

/** Read tool configuration. */
export interface Config {
  /** Register `read_file`. Defaults to true. */
  readonly read?: boolean
  /** Default and maximum number of lines returned by one call. */
  readonly readLimit?: number
  /** Maximum characters returned for a single line before truncation. */
  readonly readMaxLineLength?: number
  /** Maximum bytes returned for the selected lines of one call. */
  readonly readMaxBytes?: number
  /** Files at or above this size stream instead of loading whole into memory. */
  readonly readStreamMinSize?: number
}

/**
 * Register `read_file`.
 * @param ctx - plugin context.
 * @param config - enablement flags.
 */
export function apply(ctx: Context, config: Config = {}): void {
  void ctx
  void config
  // TODO(skeleton): ctx.tools.register(defineTool({ name: 'read_file', ... }))
}
