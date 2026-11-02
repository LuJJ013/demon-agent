/**
 * Native tool executor. Executes model tool calls in-process after `ctx.tools`
 * has validated, guarded, and dispatched them.
 *
 * Skeleton status: plugin metadata only; serial/parallel execution, timeout,
 * and cancellation are TODO.
 *
 * @module @micro-harness/core/executor-native
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'executor-native'

/** The executor consumes the tool registry. */
export const inject: string[] = ['tools']

/**
 * Mount the native executor.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  void ctx
  // TODO(skeleton): install the native executor into ctx.tools.
}
