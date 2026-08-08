import type { Hono } from 'hono'

export interface StorageUploadUrl {
  url: string
  fields?: Record<string, string>
}

/**
 * Shape a pluggable storage adapter must satisfy — see docs/SPEC.md#storage.
 * Defined here (not in `@deadly-studio/oxygen-storage`) so this package
 * never depends on that one, same pattern as `CmsAuthStrategy`/
 * `PermissionsStrategy` (see auth.ts/permissions.ts).
 */
export interface StorageAdapter {
  getUploadUrl(key: string, contentType: string): Promise<StorageUploadUrl>
  getDownloadUrl(key: string): Promise<string>
  delete(key: string): Promise<void>
  /**
   * Routes this adapter needs mounted to actually receive uploads/serve
   * downloads itself, at `/storage/:slug` relative to the `oxygen()` mount
   * point — only `@deadly-studio/oxygen-storage`'s `localStorage()` dev
   * adapter needs this; an S3-backed adapter's presigned URLs point straight
   * at the bucket, bypassing oxygen entirely (docs/SPEC.md#storage).
   */
  mount?(): Hono
}

/** Used when `storage` is configured as a single adapter rather than a slug-keyed map — see `upload(slug?)` in docs/FIELDS.md#relational-fields. */
export const DEFAULT_STORAGE_SLUG = 'default'

function isStorageAdapter(value: StorageAdapter | Record<string, StorageAdapter>): value is StorageAdapter {
  return typeof (value as StorageAdapter).getUploadUrl === 'function'
}

/** A bare adapter normalizes to `{ default: adapter }` so `upload()` (no slug) and `upload('default')` are equivalent. */
export function normalizeStorage(
  storage: StorageAdapter | Record<string, StorageAdapter> | undefined,
): Record<string, StorageAdapter> {
  if (!storage) return {}
  return isStorageAdapter(storage) ? { [DEFAULT_STORAGE_SLUG]: storage } : storage
}
