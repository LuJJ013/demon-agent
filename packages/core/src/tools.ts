/**
 * Tool registry and execution pipeline seam (`ctx.tools`). Owns definitions,
 * schema projection, guards, policy events, and dispatch to a mounted
 * executor. It does not implement any concrete tool.
 *
 * Skeleton status: the service key and authoring contracts exist; defineTool,
 * register, projection, and execution are TODO.
 *
 * @module @micro-harness/core/tools
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from './llm.ts'
import type {} from './session.ts'
import type {} from './system-prompt.ts'

/** JSON-schema-ish parameter description understood by the tool layer. */
export interface ToolParameterSchema {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
  readonly description?: string
  /** Whether the model must supply this parameter. */
  readonly required?: boolean
  readonly enum?: readonly string[]
  readonly items?: ToolParameterSchema
  readonly properties?: Readonly<Record<string, ToolParameterSchema>>
}

/** Canonical output plus its model-facing rendering. */
export interface ToolOutput<Args, Value> {
  /** Shape of the canonical JSON value, used for validation and logging. */
  readonly schema: Record<string, unknown>
  /** Deterministic conversion of the canonical value to model-visible blocks. */
  render(args: Args, value: Value): readonly ContentBlock[]
}

/** Per-call execution context. */
export interface ToolExecutionContext {
  readonly callId: string
  /** Cancellation for the whole step; every I/O call must receive it. */
  readonly signal: AbortSignal
  readonly sessionId?: string
}

/** A model-visible tool. */
export interface ToolDefinition<Args = unknown, Value = unknown> {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, ToolParameterSchema>>
  readonly output: ToolOutput<Args, Value>
  execute(args: Args, execution: ToolExecutionContext): Promise<Value>
  /** Cooperative timeout budget in milliseconds. */
  readonly timeoutMs?: number
  /** Whether this tool may run beside sibling calls in one step. */
  readonly isConcurrencySafe?: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Tool registry and dispatcher. */
    tools: ToolsService
  }
}

/**
 * The tool registry. Registrations are effects: unmounting the plugin removes
 * exactly the tools it added.
 */
export class ToolsService extends Service {
  static inject = ['systemPrompt']

  constructor(ctx: Context) {
    super(ctx, 'tools')
    // TODO(skeleton): register(), definitions(), describe(), execute().
  }
}

export default ToolsService
