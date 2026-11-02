/**
 * Concrete agent loop (`ctx.agentLoop`). Drives turns and steps, calls
 * `ctx.llm`, executes tool calls through `ctx.tools`, and appends every
 * model-visible fact to `ctx.sessions`.
 *
 * Skeleton status: the service key and dependencies exist; the turn/step state
 * machine, inbox, cancellation, and persistence are TODO.
 *
 * @module @micro-harness/core/agent-loop
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from './agent.ts'
import type {} from './llm.ts'
import type {} from './session.ts'
import type {} from './system-prompt.ts'
import type {} from './tools.ts'

/** One statically configured agent identity. */
export interface AgentEntry {
  readonly id: string
  readonly model?: string
  readonly systemPrompt?: string
}

/** Agent loop configuration. */
export interface Config {
  /** Agents to create at startup. An empty list is valid. */
  readonly agents?: readonly AgentEntry[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The concrete turn/step loop. */
    agentLoop: AgentLoop
  }
}

/**
 * The agent loop service.
 */
export class AgentLoop extends Service {
  static inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt']

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentLoop')
    void config
    // TODO(skeleton): create configured agents and implement turn/step flow.
  }
}

export default AgentLoop
