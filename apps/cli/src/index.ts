/**
 * Public module surface of the CLI package. The executable is `bin.ts`.
 *
 * @module @micro-harness/cli
 */

export { parseArgs, runCli } from './args.ts'
export type { Invocation } from './args.ts'
export { bootProfile } from './profile-boot.ts'
export type { ProfileLayers } from './profile-boot.ts'
