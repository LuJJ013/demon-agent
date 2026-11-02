/**
 * Model access seam (`ctx.llm`). Owns the wire-neutral message vocabulary,
 * adapter registration, and streaming. Concrete providers live in separate
 * packages such as `@micro-harness/llm-deepseek`.
 *
 * Skeleton status: the service key and types exist; adapter lookup, streaming,
 * retries, and usage accounting are TODO.
 *
 * @module @micro-harness/core/llm
 */

import { Service, type Context } from '@deepseek-ai/cordis'

/** Role of one message in a model request. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

/** Plain text content. */
export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** Image content, encoded for transport. */
export interface ImageBlock {
  readonly type: 'image'
  readonly mediaType: string
  readonly data: string
}

/** A model-requested tool invocation. */
export interface ToolCallBlock {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

/** The result of one tool invocation, fed back to the model. */
export interface ToolResultBlock {
  readonly type: 'tool-result'
  readonly toolCallId: string
  readonly content: string
  readonly isError?: boolean
}

/** Closed union of content the model can see or produce. */
export type ContentBlock = TextBlock | ImageBlock | ToolCallBlock | ToolResultBlock

/** One conversation message. */
export interface Message {
  readonly role: MessageRole
  readonly content: readonly ContentBlock[]
}

/** Tool schema projected into a model request. */
export interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

/** A normalized model request. */
export interface ModelRequest {
  readonly model: string
  readonly messages: readonly Message[]
  readonly tools?: readonly ToolSchema[]
}

/** Incremental stream event. */
export type ModelStreamEvent =
  | { readonly type: 'text-delta'; readonly text: string }
  | { readonly type: 'tool-call'; readonly call: ToolCallBlock }
  | { readonly type: 'usage'; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly type: 'done'; readonly finishReason: 'stop' | 'tool-calls' | 'length' | 'error' }

/** Provider adapter contract. */
export interface ModelAdapter {
  readonly id: string
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Model access seam. */
    llm: LlmRuntime
  }
}

/**
 * The model access service. One instance per context tree.
 */
export class LlmRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
    // TODO(skeleton): register adapters, select a provider, prepare calls, stream.
  }
}

export default LlmRuntime
