import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import {
  buildSchema,
  defineCollection,
  defineSingle,
  number,
  relation,
  select,
  text,
  timestamp,
} from '@deadly-studio/oxygen-fields'
import { beforeEach, describe, expect, it } from 'vitest'
import { oxygen } from './oxygen.js'

const changeLog: unknown[] = []

const Users = defineCollection({ slug: 'users', fields: { name: text().required() } })

const Posts = defineCollection({
  slug: 'posts',
  fields: {
    title: text().required().unique(),
    views: number().int().default(0),
    status: select(['draft', 'published']),
    author: relation('users'),
    publishedAt: timestamp(),
  },
  hooks: {
    beforeChange: [
      (data) => ({
        ...data,
        title: typeof data.title === 'string' ? data.title.trim() : data.title,
      }),
    ],
    afterChange: [
      (doc) => {
        changeLog.push(doc)
      },
    ],
  },
})

const SiteSettings = defineSingle({
  slug: 'site-settings',
  fields: { supportEmail: text().required().default('support@example.com') },
})

async function createTestApp() {
  const client = createClient({ url: ':memory:' })
  await client.execute('PRAGMA foreign_keys = ON;')
  const db: LibSQLDatabase = drizzle(client)

  const tables = buildSchema([
    { slug: Users.slug, fields: Users.fields },
    { slug: Posts.slug, fields: Posts.fields },
    { slug: SiteSettings.slug, fields: SiteSettings.fields },
  ])
  const { apply } = await pushSQLiteSchema(tables, db)
  await apply()

  return oxygen({ db, collections: [Users, Posts], singles: [SiteSettings] })
}

function json(body: unknown) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

// `Response.json()` types as `unknown` here (no DOM lib) — this project's
// tsconfig only pulls in ES2022, see tsconfig.base.json.
async function readJson(res: Response): Promise<any> {
  return res.json()
}

describe('oxygen()', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>

  beforeEach(async () => {
    changeLog.length = 0
    app = await createTestApp()
  })

  it('rejects an invalid create with a 400 field-error envelope', async () => {
    const res = await app.request('/collections/posts', json({}))
    expect(res.status).toBe(400)
    const body = await readJson(res)
    expect(body.errors).toEqual([{ field: 'title', message: 'title is required.' }])
  })

  it('creates a document, applying hooks, an implicit id/timestamps, and the column-level default', async () => {
    const res = await app.request('/collections/posts', json({ title: '  Hello  ', status: 'draft' }))
    expect(res.status).toBe(201)
    const body = await readJson(res)
    expect(body.message).toBe('posts created.')
    expect(body.doc.title).toBe('Hello') // beforeChange hook trims
    expect(body.doc.views).toBe(0) // SQLite column default, since the field was omitted entirely
    expect(body.doc.id).toHaveLength(26)
    expect(body.doc.createdAt).toBeTruthy()
    expect(changeLog).toHaveLength(1) // afterChange hook ran
  })

  it('gets a document by id, and 404s for an unknown one', async () => {
    const created = await readJson(await app.request('/collections/posts', json({ title: 'Get me' })))

    const found = await app.request(`/collections/posts/${created.doc.id}`)
    expect(found.status).toBe(200)
    expect((await readJson(found)).title).toBe('Get me')

    const missing = await app.request('/collections/posts/does-not-exist')
    expect(missing.status).toBe(404)
  })

  it('updates a document, validating the merged doc without requiring the untouched fields to be resent', async () => {
    const created = await readJson(await app.request('/collections/posts', json({ title: 'Original' })))

    const res = await app.request(`/collections/posts/${created.doc.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.doc.title).toBe('Original') // untouched, carried over from the previous row
    expect(body.doc.status).toBe('published')
  })

  it('deletes a document, then 404s on subsequent access', async () => {
    const created = await readJson(await app.request('/collections/posts', json({ title: 'Delete me' })))

    const res = await app.request(`/collections/posts/${created.doc.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect((await readJson(res)).message).toBe('posts deleted.')

    const found = await app.request(`/collections/posts/${created.doc.id}`)
    expect(found.status).toBe(404)
  })

  it('reports a duplicate unique() value as a 409', async () => {
    await app.request('/collections/posts', json({ title: 'Dupe' }))
    const res = await app.request('/collections/posts', json({ title: 'Dupe' }))
    expect(res.status).toBe(409)
  })

  it("reports a relation() to a nonexistent row as a 409 (FK constraint)", async () => {
    const res = await app.request('/collections/posts', json({ title: 'Orphan', author: 'nope' }))
    expect(res.status).toBe(409)
  })

  it('lists documents honoring ?where=, ?sort=, and pagination', async () => {
    await app.request('/collections/posts', json({ title: 'A', status: 'draft', views: 5 }))
    await app.request('/collections/posts', json({ title: 'B', status: 'published', views: 1 }))
    await app.request('/collections/posts', json({ title: 'C', status: 'published', views: 9 }))

    const where = encodeURIComponent(JSON.stringify({ status: 'published' }))
    const res = await app.request(`/collections/posts?where=${where}&sort=-views&limit=1&page=2`)
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.totalDocs).toBe(2)
    expect(body.totalPages).toBe(2)
    expect(body.docs).toHaveLength(1)
    expect(body.docs[0].title).toBe('B') // views 9 then 1, descending — page 2 of size 1 is the second (views: 1)
  })

  it('rejects an unknown ?where= field with a 400', async () => {
    const where = encodeURIComponent(JSON.stringify({ nope: 1 }))
    const res = await app.request(`/collections/posts?where=${where}`)
    expect(res.status).toBe(400)
  })

  it("resolves a select() field's configured options, and 404s for a non-select field", async () => {
    const options = await app.request('/collections/posts/fields/status/options')
    expect(options.status).toBe(200)
    expect(await readJson(options)).toEqual({
      options: [
        { value: 'draft', label: 'draft' },
        { value: 'published', label: 'published' },
      ],
    })

    const notSelect = await app.request('/collections/posts/fields/title/options')
    expect(notSelect.status).toBe(404)
  })

  it('serves a single, seeded lazily on first request, with only GET/PATCH', async () => {
    const get = await app.request('/singles/site-settings')
    expect(get.status).toBe(200)
    expect((await readJson(get)).supportEmail).toBe('support@example.com')

    const patch = await app.request('/singles/site-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supportEmail: 'new@example.com' }),
    })
    expect(patch.status).toBe(200)
    expect((await readJson(patch)).doc.supportEmail).toBe('new@example.com')

    expect((await app.request('/singles/site-settings', { method: 'POST' })).status).toBe(404)
    expect((await app.request('/singles/site-settings/some-id')).status).toBe(404)
  })
})
