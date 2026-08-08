import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { Hono } from 'hono'
import type { StorageAdapter } from '@deadly-studio/oxygen'

export interface LocalStorageOptions {
  /** Directory files are written to/read from — created on first write if missing. */
  dir: string
  /**
   * The externally-reachable URL this adapter's `mount()`-ed router is
   * served at, e.g. `http://localhost:3000/cms/storage/default` if
   * `oxygen()` is mounted at `/cms` and this adapter is the `default` slug
   * (docs/SPEC.md#storage) — needed because `getUploadUrl`/`getDownloadUrl`
   * return absolute URLs the client fetches directly, and this adapter has
   * no way to know its own mount path otherwise.
   */
  baseUrl: string
}

function assertSafeKey(key: string): void {
  const normalized = normalize(key)
  if (key === '' || normalized.startsWith('..') || normalized.startsWith('/')) {
    throw new Error(`localStorage: refusing an unsafe key '${key}'.`)
  }
}

/**
 * Disk-backed dev adapter — see docs/BUILD_PLAN.md#9-storage. Not for
 * production use: its upload/download routes carry no auth of their own
 * beyond whatever the consumer wraps `oxygen()`'s mount point in, and it's a
 * single directory on one machine's disk rather than durable/shared storage.
 */
export function localStorage(options: LocalStorageOptions): StorageAdapter {
  const baseUrl = options.baseUrl.replace(/\/$/, '')

  return {
    async getUploadUrl(key) {
      assertSafeKey(key)
      return { url: `${baseUrl}/${key}` }
    },

    async getDownloadUrl(key) {
      assertSafeKey(key)
      return `${baseUrl}/${key}`
    },

    async delete(key) {
      assertSafeKey(key)
      await rm(join(options.dir, key), { force: true })
    },

    mount() {
      const app = new Hono()

      app.put('/:key{.+}', async (c) => {
        const key = c.req.param('key')
        assertSafeKey(key)
        const target = join(options.dir, key)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, Buffer.from(await c.req.arrayBuffer()))
        return c.body(null, 204)
      })

      app.get('/:key{.+}', async (c) => {
        const key = c.req.param('key')
        assertSafeKey(key)
        try {
          return c.body(await readFile(join(options.dir, key)))
        } catch {
          return c.notFound()
        }
      })

      return app
    },
  }
}
