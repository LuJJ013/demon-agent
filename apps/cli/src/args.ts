/**
 * Command-line surface for `mh`.
 *
 * @module @micro-harness/cli/args
 */

/** Parsed invocation. */
export interface Invocation {
  /** Profile name. Defaults to `minimal`. */
  readonly profile: string
  /** Extra patch files applied after the profile. */
  readonly patches: readonly string[]
  /** One-shot task, when present. */
  readonly task: string | undefined
}

/**
 * Parse `--profile`, `--patch`, `--help`, and the positional task.
 *
 * TODO(skeleton): implement with `node:util` parseArgs.
 * @param argv - arguments after the executable name.
 * @returns the normalized invocation.
 */
export function parseArgs(argv: readonly string[]): Invocation {
  void argv
  throw new Error('argument parsing is not implemented yet')
}

/**
 * Boot the selected profile and run one task.
 *
 * TODO(skeleton): compose `cordis.patch.yml`, mount Cordis, run the agent.
 * @param argv - arguments after the executable name.
 */
export async function runCli(argv: readonly string[]): Promise<void> {
  const invocation = parseArgs(argv)
  void invocation
  throw new Error('profile boot is not implemented yet')
}
