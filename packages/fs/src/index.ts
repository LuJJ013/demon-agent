/**
 * Filesystem seam (`ctx.fs`) for one execution world. Backends own stable
 * target identity, process paths, containment, text decoding, binary
 * rejection, and atomic mutations. Consumers never touch host paths directly.
 *
 * Skeleton status: the abstract service key and types exist; resolve/stat/
 * read/write/edit are TODO.
 *
 * @module @micro-harness/fs
 */

import { Service, type Context } from '@deepseek-ai/cordis'

/** Opaque, provider-owned identity for one file or directory. */
export type FsTargetKey = string

/** Resolved target. `targetKey` is stable across aliases within one provider. */
export interface FsTarget {
  readonly targetKey: FsTargetKey
  readonly displayPath: string
}

/** Kind of filesystem entry. */
export type FsEntryKind = 'file' | 'directory' | 'symlink' | 'other'

/** Metadata only; never content. */
export interface FsInfo {
  readonly kind: FsEntryKind
  readonly size: number
  readonly mtimeMs: number
}

/** Stable error codes surfaced to tools and the model. */
export type FsErrorCode =
  | 'FS_NOT_FOUND'
  | 'FS_NOT_A_FILE'
  | 'FS_NOT_A_DIRECTORY'
  | 'FS_PERMISSION_DENIED'
  | 'FS_TOO_LARGE'
  | 'FS_IO_ERROR'
  | 'FS_OUTSIDE_WORKSPACE'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Filesystem seam for the active execution world. */
    fs: FileSystem
  }
}

/**
 * Abstract filesystem provider. The minimal agent only needs resolve/stat/
 * readText; write/edit stay on the same seam so stale guards and atomic
 * publication share one place when they land.
 */
export abstract class FileSystem extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fs')
    // TODO(skeleton): resolve(), stat(), readText(), listDir(), writeText(),
    // editText(), and FsError codes.
  }
}

export default FileSystem
