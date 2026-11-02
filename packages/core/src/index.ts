/**
 * Type surface of the core package. Runtime entry points are subpath exports
 * (`./llm`, `./tools`, ...); importing this module mounts nothing.
 *
 * @module @micro-harness/core
 */

export type * from './llm.ts'
export type * from './session.ts'
// Each seam exports its own plugin `Config`; re-export this one's members
// explicitly so the aggregate barrel does not collide with `agent-loop`'s.
// Import `Config` from the `./system-prompt` subpath instead.
export type { PromptContext, PromptSection, SystemPrompt } from './system-prompt.ts'
export type * from './tools.ts'
export type * from './agent.ts'
export type * from './agent-loop.ts'
