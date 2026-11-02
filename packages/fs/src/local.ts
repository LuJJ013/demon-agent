/**
 * Host-filesystem implementation of `ctx.fs`. Owns cwd resolution, realpath
 * identity, containment checks, decoding, and atomic writes.
 *
 * Skeleton status: the provider class exists but implements no operation.
 *
 * @module @micro-harness/fs/local
 */

import type { Context } from '@deepseek-ai/cordis'
import { FileSystem } from './index.ts'

/** Local filesystem configuration. */
export interface Config {
  /** Base directory for relative paths. Defaults to the process cwd. */
  readonly cwd?: string
  /** Exclusive UTF-8 byte limit on each overwrite-diff side. */
  readonly diffBasisMaxBytes?: number
}

/**
 * Local filesystem provider. Mounting this plugin registers `ctx.fs`.
 */
export class LocalFileSystem extends FileSystem {
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    void config
    // TODO(skeleton): implement the FileSystem contract against node:fs/promises.
  }
}

export default LocalFileSystem
