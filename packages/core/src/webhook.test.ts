import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { buildSchema, defineCollection, text } from '@deadly-studio/oxygen-fields'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { oxygen } from './oxygen.js'
import { processWebhookDeliveries, webhook, WEBHOOK_BACKOFF_MS } from './webhook.js'
import { webhookDeliveries, webhookTables } from './webhook-tables.js'

function json(body: unknown) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

async function readJson(res: Response): Promise<any> {
  return res.json()
}

/** afterChange/afterDelete hooks are fire-and-forget (docs/SPEC.md#hook-lifecycle) — give the signing+fetch chain a real macrotask tick to finish. */
function flushHooks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

async function createDb(tables: Record<string, unknown>): Promise<LibSQLDatabase> {
  const client = createClient({ url: ':memory:' })
  await client.execute('PRAGMA foreign_keys = ON;')
  const db: LibSQLDatabase = drizzle(client)
  const { apply } = await pushSQLiteSchema(tables, db)
  await apply()
  return db
}

describe('webhook() + oxygen() wiring', () => {
  let deliveries: { url: string; init: RequestInit }[]
  let fetchImpl: typeof fetch

  beforeEach(() => {
    deliveries = []
    fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      deliveries.push({ url: String(url), init: init ?? {} })
      return new Response('ok', { status: 200 })
    }) as typeof fetch
  })

  it('delivers a signed POST to the configured url on afterChange', async () => {
    const Posts = defineCollection({
      slug: 'posts',
      fields: { title: text().required() },
      hooks: { afterChange: [webhook({ url: 'https://example.test/hook', secret: 's3cret', fetch: fetchImpl })] },
    })
    const tables = buildSchema([{ slug: Posts.slug, fields: Posts.fields }])
    const db = await createDb({ ...tables, ...webhookTables })
    const app = oxygen({ db, collections: [Posts] })

    await app.request('/collections/posts', json({ title: 'Hello' }))
    // fire-and-forget: give the microtask queue a turn to run the hook
    await flushHooks()

    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]!.url).toBe('https://example.test/hook')
    const body = JSON.parse(deliveries[0]!.init.body as string)
    expect(body.event).toBe('afterChange')
    expect(body.collection).toBe('posts')
    expect(body.doc.title).toBe('Hello')
    const signature = (deliveries[0]!.init.headers as Record<string, string>)['X-Oxygen-Signature']
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('signs with HMAC-SHA256 over the exact raw body', async () => {
    const Posts = defineCollection({
      slug: 'posts-sig',
      fields: { title: text().required() },
      hooks: { afterChange: [webhook({ url: 'https://example.test/hook', secret: 's3cret', fetch: fetchImpl })] },
    })
    const tables = buildSchema([{ slug: Posts.slug, fields: Posts.fields }])
    const db = await createDb({ ...tables, ...webhookTables })
    const app = oxygen({ db, collections: [Posts] })

    await app.request('/collections/posts-sig', json({ title: 'Sig' }))
    await flushHooks()

    const body = deliveries[0]!.init.body as string
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s3cret'), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ])
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
    const expected = `sha256=${Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`
    expect((deliveries[0]!.init.headers as Record<string, string>)['X-Oxygen-Signature']).toBe(expected)
  })

  it('fires on afterDelete too, with no previousDoc', async () => {
    const Posts = defineCollection({
      slug: 'posts-del',
      fields: { title: text().required() },
      hooks: { afterDelete: [webhook({ url: 'https://example.test/hook', secret: 's3cret', fetch: fetchImpl })] },
    })
    const tables = buildSchema([{ slug: Posts.slug, fields: Posts.fields }])
    const db = await createDb({ ...tables, ...webhookTables })
    const app = oxygen({ db, collections: [Posts] })

    const created = await readJson(await app.request('/collections/posts-del', json({ title: 'Bye' })))
    await app.request(`/collections/posts-del/${created.doc.id}`, { method: 'DELETE' })
    await flushHooks()

    expect(deliveries).toHaveLength(1)
    const body = JSON.parse(deliveries[0]!.init.body as string)
    expect(body.event).toBe('afterDelete')
    expect(body.doc.title).toBe('Bye')
  })

  it('persists a failed delivery for retry, scheduled at +1m', async () => {
    const failingFetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
    const Posts = defineCollection({
      slug: 'posts-fail',
      fields: { title: text().required() },
      hooks: { afterChange: [webhook({ url: 'https://example.test/hook', secret: 's3cret', fetch: failingFetch })] },
    })
    const tables = buildSchema([{ slug: Posts.slug, fields: Posts.fields }])
    const db = await createDb({ ...tables, ...webhookTables })
    const app = oxygen({ db, collections: [Posts] })

    const before = Date.now()
    await app.request('/collections/posts-fail', json({ title: 'Retry me' }))
    await flushHooks()

    const rows = await db.select().from(webhookDeliveries).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('pending')
    expect(rows[0]!.attempts).toBe(1)
    expect(rows[0]!.event).toBe('afterChange')
    expect(rows[0]!.collection).toBe('posts-fail')
    expect(rows[0]!.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(WEBHOOK_BACKOFF_MS[0]! - 1000)
  })
})

describe('processWebhookDeliveries', () => {
  async function seedFailedDelivery(db: LibSQLDatabase, overrides: Partial<typeof webhookDeliveries.$inferInsert> = {}) {
    await db.insert(webhookDeliveries).values({
      id: 'delivery-1',
      event: 'afterChange',
      collection: 'posts',
      url: 'https://example.test/hook',
      payload: '{"event":"afterChange"}',
      signature: 'sha256=deadbeef',
      status: 'pending',
      attempts: 1,
      nextAttemptAt: new Date(Date.now() - 1000),
      lastError: 'boom',
      createdAt: new Date(),
      ...overrides,
    })
  }

  it('ignores rows not yet due', async () => {
    const db = await createDb(webhookTables)
    await seedFailedDelivery(db, { nextAttemptAt: new Date(Date.now() + 60_000) })
    const fetchImpl = vi.fn()
    const result = await processWebhookDeliveries(db, { fetch: fetchImpl as unknown as typeof fetch })
    expect(result).toEqual({ processed: 0, delivered: 0, failed: 0, stillPending: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('marks a successful retry delivered, resending the stored payload+signature verbatim', async () => {
    const db = await createDb(webhookTables)
    await seedFailedDelivery(db)
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch
    const result = await processWebhookDeliveries(db, { fetch: fetchImpl })
    expect(result).toEqual({ processed: 1, delivered: 1, failed: 0, stillPending: 0 })
    const [call] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call).toBe('https://example.test/hook')
    const row = (await db.select().from(webhookDeliveries).all())[0]!
    expect(row.status).toBe('delivered')
  })

  it('advances the backoff schedule on a failed retry', async () => {
    const db = await createDb(webhookTables)
    await seedFailedDelivery(db, { attempts: 1 })
    const failingFetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
    const before = Date.now()
    const result = await processWebhookDeliveries(db, { fetch: failingFetch })
    expect(result).toEqual({ processed: 1, delivered: 0, failed: 0, stillPending: 1 })
    const row = (await db.select().from(webhookDeliveries).all())[0]!
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(2)
    expect(row.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(WEBHOOK_BACKOFF_MS[1]! - 1000)
  })

  it('gives up after exhausting the backoff schedule', async () => {
    const db = await createDb(webhookTables)
    await seedFailedDelivery(db, { attempts: WEBHOOK_BACKOFF_MS.length })
    const failingFetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
    const result = await processWebhookDeliveries(db, { fetch: failingFetch })
    expect(result).toEqual({ processed: 1, delivered: 0, failed: 1, stillPending: 0 })
    const row = (await db.select().from(webhookDeliveries).all())[0]!
    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(WEBHOOK_BACKOFF_MS.length + 1)
  })
})
