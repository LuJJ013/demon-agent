#!/usr/bin/env node
/**
 * `mh` executable entry. Errors are printed once and mapped to a nonzero exit
 * code; the skeleton fails loud instead of pretending to run.
 *
 * @module @micro-harness/cli/bin
 */

import { runCli } from './args.ts'

runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`mh: ${message}\n`)
  process.exitCode = 1
})
