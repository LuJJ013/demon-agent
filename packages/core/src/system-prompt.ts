/**
 * System prompt assembly seam (`ctx.systemPrompt`). Plugins contribute ordered
 * sections; the agent loop asks for the rendered prompt once per step.
 *
 * Skeleton status: the service key and section type exist; rendering,
 * variables, and tool-description projection are TODO.
 *
 * @module @micro-harness/core/system-prompt
 */

import { Service, type Context } from '@deepseek-ai/cordis'

/** Input available when a section is rendered. */
export interface PromptContext {
  readonly sessionId: string
  readonly model: string
}

/** One ordered contribution to the system prompt. */
export interface PromptSection {
  readonly id: string
  /** Lower values render first. Ties are resolved by registration order. */
  readonly order?: number
  readonly content: string | ((context: PromptContext) => string | Promise<string>)
}

/** Plugin config: the deployment-authored fragment of the system prompt. */
export interface Config {
  /** Include the fixed harness identity before the deployment persona. Defaults to true. */
  readonly includeHarnessIdentity?: boolean
  /** Include optional runtime-context snapshots in model history. Defaults to true. */
  readonly includeRuntimeContext?: boolean
  /** Deployment-wide persona prefix before first-party guidance. */
  readonly personaPrefix?: string
  /** Persona suffix after first-party guidance. Defaults to empty. */
  readonly personaSuffix?: string
  /** Model-facing tool names in order; omitted means lexicographic order. */
  readonly toolOrder?: readonly string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Ordered prompt section registry. */
    systemPrompt: SystemPrompt
  }
}

/**
 * The prompt assembly service. Sections are scoped to the calling context, so
 * a per-agent override never leaks into sibling agents.
 */
export class SystemPrompt extends Service {
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'systemPrompt')
    void config
    // TODO(skeleton): section(), variable(), tools(), and render().
  }
}

export default SystemPrompt
