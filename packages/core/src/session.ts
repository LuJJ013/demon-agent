/**
 * Session store seam (`ctx.sessions`). A session is an append-only event log;
 * every model-visible fact must be reconstructible from it.
 *
 * Skeleton status: the service key and event types exist; append, replay, and
 * persistence are TODO.
 *
 * @module @micro-harness/core/session
 */

import { Service, type Context } from '@deepseek-ai/cordis'

/** Opaque session identifier. */
export type SessionId = string

/** Immutable session metadata. */
export interface SessionHeader {
  readonly id: SessionId
  readonly createdAt: number
  readonly model?: string
}

/** One persisted event. `seq` is monotonic within a session. */
export interface SessionEvent<Data = unknown> {
  readonly id: string
  readonly seq: number
  readonly at: number
  readonly type: string
  readonly data: Data
}

/** Caller-supplied part of an event; the store assigns id/seq/at. */
export type SessionEventInput<Data = unknown> = Omit<SessionEvent<Data>, 'id' | 'seq' | 'at'>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable conversation event store. */
    sessions: SessionStore
  }
}

/**
 * The session store. The first implementation can be in-memory; the contract
 * is append-only so JSONL or SQLite backends can replace it later.
 */
export class SessionStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessions')
    // TODO(skeleton): create/load sessions, append events, replay projections.
  }
}

export default SessionStore
