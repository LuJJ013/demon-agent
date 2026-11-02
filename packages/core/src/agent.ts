/**
 * Agent registry and lifecycle seam (`ctx.agents`). An agent binds a session
 * to a model selection and an implementation; the registry owns creation,
 * resume, and ordered teardown.
 *
 * Skeleton status: the service key and handle types exist; create/resume/close
 * are TODO.
 *
 * @module @micro-harness/core/agent
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from './session.ts'

/** Opaque agent identifier. */
export type AgentId = string

/** Which provider/model an agent should use. */
export interface ModelSelection {
  readonly provider: string
  readonly model: string
}

/** Inputs required to create an agent. */
export interface AgentOptions {
  readonly sessionId: SessionId
  readonly model: ModelSelection
  readonly systemPrompt?: string
}

/** Handle returned by the registry; closing is idempotent. */
export interface AgentHandle {
  readonly id: AgentId
  readonly sessionId: SessionId
  close(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Agent lifecycle registry. */
    agents: AgentRegistry
  }
}

/**
 * The agent registry. Implementations are supplied by a factory plugin such as
 * `@micro-harness/core/agent-loop`.
 */
export class AgentRegistry extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agents')
    // TODO(skeleton): create(), resume(), lookup(), and teardown.
  }
}

export default AgentRegistry
