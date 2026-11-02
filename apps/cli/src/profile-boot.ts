/**
 * Profile composition and Cordis boot. Layers apply to the empty root entry
 * list in order: the CLI's `cordis.patch.yml`, an optional user profile, then
 * an optional `--patch` overlay.
 *
 * Skeleton status: contract only.
 *
 * @module @micro-harness/cli/profile-boot
 */

/** Layers assembled before the root Cordis tree is mounted. */
export interface ProfileLayers {
  /** Bundle/profile patch path, e.g. `apps/cli/cordis.patch.yml`. */
  readonly bundlePatch: string
  /** User profile patch applied above the bundle. */
  readonly profilePatch?: string
  /** Invocation-scoped patch (`--patch`), applied last. */
  readonly invocationPatch?: string
}

/**
 * Compose the layers, mount the root tree, and return once the app is idle.
 *
 * TODO(skeleton): read bundle metadata, apply patches, start the loader, and
 * install fail-loud + graceful shutdown handlers.
 * @param layers - ordered patch layers.
 */
export async function bootProfile(layers: ProfileLayers): Promise<void> {
  void layers
  throw new Error('profile boot is not implemented yet')
}
