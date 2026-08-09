import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { Hono } from 'hono'
import { buildSchema, defineCollection, defineSingle, group, relation, select, text } from '@deadly-studio/oxygen-fields'
import { describe, expect, it } from 'vitest'
import type { CmsAuthStrategy } from './auth.js'
import { oxygen } from './oxygen.js'

/** A minimal fake CmsAuthStrategy — 401s unless the request carries `x-fake-session`. */
function fakeCmsAuth(): CmsAuthStrategy {
  return {
    createRouter: () => new Hono(),
    middleware: () => async (c, next) => {
      if (!c.req.header('x-fake-session')) return c.json({ errors: [{ message: 'Not authenticated.' }] }, 401)
      await next()
    },
  }
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

describe('GET /schema', () => {
  it('serializes collections and singles, stripping functions', async () => {
    const Posts = defineCollection({
      slug: 'posts',
      fields: {
        title: text().required().minLength(3),
        status: select(['draft', 'published']),
        author: relation('posts').required(),
        hero: group({ heading: text() }),
      },
    })
    const SiteSettings = defineSingle({ slug: 'site-settings', fields: { supportEmail: text().required() } })
    const tables = buildSchema([
      { slug: Posts.slug, fields: Posts.fields },
      { slug: SiteSettings.slug, fields: SiteSettings.fields },
    ])
    const db = await createDb(tables)
    const app = oxygen({ db, collections: [Posts], singles: [SiteSettings] })

    const res = await app.request('/schema')
    expect(res.status).toBe(200)
    const body = await readJson(res)

    expect(body.collections).toHaveLength(1)
    expect(body.collections[0].slug).toBe('posts')
    expect(body.collections[0].auth).toBe(false)
    expect(body.collections[0].fields.title).toEqual({
      kind: 'text',
      required: true,
      unique: false,
      indexed: false,
      hasDefault: false,
      hasCondition: false,
      minLength: 3,
      maxLength: undefined,
      matches: undefined,
    })
    expect(body.collections[0].fields.status.options).toEqual(['draft', 'published'])
    expect(body.collections[0].fields.author).toMatchObject({ kind: 'relation', to: 'posts', required: true })
    expect(body.collections[0].fields.hero.fields.heading).toMatchObject({ kind: 'text' })

    expect(body.singles).toHaveLength(1)
    expect(body.singles[0].slug).toBe('site-settings')
  })

  it('reports a select() loader as the string "loader", not a function', async () => {
    const Posts = defineCollection({
      slug: 'posts-loader',
      fields: { currency: select(async () => [{ value: 'usd', label: 'USD' }]) },
    })
    const tables = buildSchema([{ slug: Posts.slug, fields: Posts.fields }])
    const db = await createDb(tables)
    const app = oxygen({ db, collections: [Posts] })

    const res = await app.request('/schema')
    const body = await readJson(res)
    expect(body.collections[0].fields.currency.options).toBe('loader')
  })

  it('flags an auth-enabled collection', async () => {
    const Customers = defineCollection({
      slug: 'customers',
      auth: true,
      fields: { email: text().required().unique() },
    })
    const tables = buildSchema([{ slug: Customers.slug, fields: Customers.fields }])
    const db = await createDb(tables)
    const app = oxygen({ db, collections: [Customers], auth: { app: { createRouter: () => new Hono() } } })

    const res = await app.request('/schema')
    const body = await readJson(res)
    expect(body.collections[0].auth).toBe(true)
  })

  it('is open by default (no auth.cms configured), matching every other route', async () => {
    const Posts = defineCollection({ slug: 'posts-open', fields: { title: text() } })
    const tables = buildSchema([{ slug: Posts.slug, fields: Posts.fields }])
    const db = await createDb(tables)
    const app = oxygen({ db, collections: [Posts] })
    expect((await app.request('/schema')).status).toBe(200)
  })

  it('requires a CMS session when auth.cms is configured, even with a PermissionsStrategy present', async () => {
    const Posts = defineCollection({ slug: 'posts-gated', fields: { title: text() } })
    const tables = buildSchema([{ slug: Posts.slug, fields: Posts.fields }])
    const db = await createDb(tables)
    const app = oxygen({
      db,
      collections: [Posts],
      auth: { cms: fakeCmsAuth() },
      // A fake PermissionsStrategy that would normally let /collections and
      // /singles bypass the CMS middleware (see oxygen.ts) — /schema isn't
      // affected by that, so it should still 401 without a session.
      permissions: { resolve: async () => ({ fields: null }) },
    })

    const denied = await app.request('/schema')
    expect(denied.status).toBe(401)

    const allowed = await app.request('/schema', { headers: { 'x-fake-session': '1' } })
    expect(allowed.status).toBe(200)
  })
})
