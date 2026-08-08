import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { buildSchema, defineCollection, text, upload } from '@deadly-studio/oxygen-fields'
import { describe, expect, it } from 'vitest'
import { oxygen } from './oxygen.js'
import type { StorageAdapter } from './storage.js'

function fakeAdapter(prefix = 'https://bucket.test'): StorageAdapter {
  return {
    async getUploadUrl(key, contentType) {
      return { url: `${prefix}/${key}`, fields: { 'Content-Type': contentType } }
    },
    async getDownloadUrl(key) {
      return `${prefix}/${key}`
    },
    async delete() {},
  }
}

function json(body: unknown) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

async function readJson(res: Response): Promise<any> {
  return res.json()
}

async function createDb(tables: Record<string, unknown>): Promise<LibSQLDatabase> {
  const client = createClient({ url: ':memory:' })
  const db: LibSQLDatabase = drizzle(client)
  const { apply } = await pushSQLiteSchema(tables, db)
  await apply()
  return db
}

describe('POST /collections/:slug/upload-url', () => {
  it('is absent (404) when the collection has no upload() field', async () => {
    const Posts = defineCollection({ slug: 'posts-no-upload', fields: { title: text().required() } })
    const tables = buildSchema([{ slug: Posts.slug, fields: Posts.fields }])
    const db = await createDb(tables)
    const app = oxygen({ db, collections: [Posts], storage: fakeAdapter() })

    const res = await app.request('/collections/posts-no-upload/upload-url', json({ filename: 'a.png', contentType: 'image/png' }))
    expect(res.status).toBe(404)
  })

  it('resolves the single upload() field without needing `field` in the body', async () => {
    const Media = defineCollection({ slug: 'media', fields: { title: text(), file: upload() } })
    const tables = buildSchema([{ slug: Media.slug, fields: Media.fields }])
    const db = await createDb(tables)
    const app = oxygen({ db, collections: [Media], storage: fakeAdapter() })

    const res = await app.request('/collections/media/upload-url', json({ filename: 'photo.png', contentType: 'image/png' }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.uploadUrl).toBe(`https://bucket.test/${body.key}`)
    expect(body.key).toMatch(/^media\/file\/[0-9A-Z]{26}-photo\.png$/)
    expect(body.fields).toEqual({ 'Content-Type': 'image/png' })
  })

  it('requires `field` when the collection has more than one upload() field', async () => {
    const Media = defineCollection({
      slug: 'media-multi',
      fields: { avatar: upload(), banner: upload() },
    })
    const tables = buildSchema([{ slug: Media.slug, fields: Media.fields }])
    const db = await createDb(tables)
    const app = oxygen({ db, collections: [Media], storage: fakeAdapter() })

    const ambiguous = await app.request('/collections/media-multi/upload-url', json({ filename: 'a.png', contentType: 'image/png' }))
    expect(ambiguous.status).toBe(400)

    const disambiguated = await app.request(
      '/collections/media-multi/upload-url',
      json({ filename: 'a.png', contentType: 'image/png', field: 'banner' }),
    )
    expect(disambiguated.status).toBe(200)
    expect((await readJson(disambiguated)).key).toMatch(/^media-multi\/banner\//)
  })

  it("404s for a 'field' that isn't an upload() field", async () => {
    const Media = defineCollection({ slug: 'media-bad-field', fields: { title: text(), file: upload() } })
    const tables = buildSchema([{ slug: Media.slug, fields: Media.fields }])
    const db = await createDb(tables)
    const app = oxygen({ db, collections: [Media], storage: fakeAdapter() })

    const res = await app.request(
      '/collections/media-bad-field/upload-url',
      json({ filename: 'a.png', contentType: 'image/png', field: 'title' }),
    )
    expect(res.status).toBe(404)
  })

  it('rejects a contentType outside .accept()', async () => {
    const Media = defineCollection({
      slug: 'media-accept',
      fields: { file: upload().accept(['image/png', 'image/jpeg']) },
    })
    const tables = buildSchema([{ slug: Media.slug, fields: Media.fields }])
    const db = await createDb(tables)
    const app = oxygen({ db, collections: [Media], storage: fakeAdapter() })

    const rejected = await app.request('/collections/media-accept/upload-url', json({ filename: 'a.pdf', contentType: 'application/pdf' }))
    expect(rejected.status).toBe(400)

    const accepted = await app.request('/collections/media-accept/upload-url', json({ filename: 'a.png', contentType: 'image/png' }))
    expect(accepted.status).toBe(200)
  })

  it("routes to the right adapter via upload(slug) when multiple adapters are configured", async () => {
    const Media = defineCollection({
      slug: 'media-adapters',
      fields: { avatar: upload('avatars'), doc: upload('documents') },
    })
    const tables = buildSchema([{ slug: Media.slug, fields: Media.fields }])
    const db = await createDb(tables)
    const app = oxygen({
      db,
      collections: [Media],
      storage: { avatars: fakeAdapter('https://avatars.test'), documents: fakeAdapter('https://docs.test') },
    })

    const avatarRes = await app.request(
      '/collections/media-adapters/upload-url',
      json({ filename: 'a.png', contentType: 'image/png', field: 'avatar' }),
    )
    expect((await readJson(avatarRes)).uploadUrl).toMatch(/^https:\/\/avatars\.test\//)

    const docRes = await app.request(
      '/collections/media-adapters/upload-url',
      json({ filename: 'a.pdf', contentType: 'application/pdf', field: 'doc' }),
    )
    expect((await readJson(docRes)).uploadUrl).toMatch(/^https:\/\/docs\.test\//)
  })

  it('500s when no storage adapter is configured at all', async () => {
    const Media = defineCollection({ slug: 'media-no-adapter', fields: { file: upload() } })
    const tables = buildSchema([{ slug: Media.slug, fields: Media.fields }])
    const db = await createDb(tables)
    const app = oxygen({ db, collections: [Media] })

    const res = await app.request('/collections/media-no-adapter/upload-url', json({ filename: 'a.png', contentType: 'image/png' }))
    expect(res.status).toBe(500)
  })
})
