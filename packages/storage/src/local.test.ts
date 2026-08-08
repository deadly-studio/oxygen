import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localStorage } from './local.js'

describe('localStorage', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oxygen-storage-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function mountedApp() {
    const adapter = localStorage({ dir, baseUrl: 'http://localhost/storage/default' })
    const app = new Hono()
    app.route('/storage/default', adapter.mount!())
    return { adapter, app }
  }

  it('round-trips an upload through its own mounted routes', async () => {
    const { adapter, app } = mountedApp()

    const { url } = await adapter.getUploadUrl('posts/photo/a.png', 'image/png')
    expect(url).toBe('http://localhost/storage/default/posts/photo/a.png')

    const putRes = await app.request(new URL(url).pathname, { method: 'PUT', body: new Uint8Array([1, 2, 3, 4]) })
    expect(putRes.status).toBe(204)

    const onDisk = await readFile(join(dir, 'posts/photo/a.png'))
    expect([...onDisk]).toEqual([1, 2, 3, 4])

    const downloadUrl = await adapter.getDownloadUrl('posts/photo/a.png')
    const getRes = await app.request(new URL(downloadUrl).pathname)
    expect(getRes.status).toBe(200)
    expect([...new Uint8Array(await getRes.arrayBuffer())]).toEqual([1, 2, 3, 4])
  })

  it('404s a GET for a missing key', async () => {
    const { app } = mountedApp()
    const res = await app.request('/storage/default/nope.png')
    expect(res.status).toBe(404)
  })

  it('delete() removes the file from disk', async () => {
    const { adapter, app } = mountedApp()
    await app.request('/storage/default/x.txt', { method: 'PUT', body: new Uint8Array([9]) })
    await adapter.delete('x.txt')
    await expect(readFile(join(dir, 'x.txt'))).rejects.toThrow()
  })

  it('rejects a path-traversal key on every operation', async () => {
    const adapter = localStorage({ dir, baseUrl: 'http://localhost/storage/default' })
    await expect(adapter.getUploadUrl('../../etc/passwd', 'text/plain')).rejects.toThrow()
    await expect(adapter.getDownloadUrl('../../etc/passwd')).rejects.toThrow()
    await expect(adapter.delete('../../etc/passwd')).rejects.toThrow()
  })
})
