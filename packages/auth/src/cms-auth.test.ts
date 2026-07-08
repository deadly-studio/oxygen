import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { oxygen } from '@deadly-studio/oxygen'
import { buildSchema, defineCollection, text } from '@deadly-studio/oxygen-fields'
import type { EmailAdapter, EmailMessage } from '@deadly-studio/oxygen-email'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { otpAuth } from './cms-auth.js'
import { cmsAuthTables } from './tables.js'

const Posts = defineCollection({ slug: 'posts', fields: { title: text().required() } })

function json(body: unknown, extraHeaders: Record<string, string> = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  }
}

async function readJson(res: Response): Promise<any> {
  return res.json()
}

function fakeEmail(): EmailAdapter & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = []
  return {
    sent,
    async send(message) {
      sent.push(message)
    },
  }
}

function codeFrom(message: EmailMessage): string {
  return /Your code is (\d{6})/.exec(message.text ?? '')![1]!
}

/** Turns a `Set-Cookie` response header into the `Cookie` header value for the next request. */
function cookieHeaderFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')!
  return setCookie.split(';')[0]!
}

// `otpAuth`'s bootstrap transaction is the first thing in this codebase to
// call `db.transaction()`. @libsql/client's local sqlite3 adapter hands the
// current connection to the transaction and lazily opens a *new* one for the
// next non-tx query (see its `sqlite3.js`) — for a real file this is
// invisible (every connection sees the same on-disk data), but a bare
// `:memory:` URL gives every connection its own separate, empty database, so
// the very next query after a transaction would find all the tables gone.
// A real (temp) file sidesteps that entirely and is closer to how oxygen
// actually gets used.
function tempDbPath(): string {
  return join(tmpdir(), `oxygen-auth-test-${crypto.randomUUID()}.db`)
}

async function createTestApp(email: ReturnType<typeof fakeEmail>, bootstrapToken?: string) {
  const dbPath = tempDbPath()
  const client = createClient({ url: `file:${dbPath}` })
  await client.execute('PRAGMA foreign_keys = ON;')
  const db: LibSQLDatabase = drizzle(client)

  const tables = {
    ...buildSchema([{ slug: Posts.slug, fields: Posts.fields }]),
    ...cmsAuthTables,
  }
  const { apply } = await pushSQLiteSchema(tables, db)
  await apply()

  const app = oxygen({
    db,
    collections: [Posts],
    auth: { cms: otpAuth({ email, cookieSecret: 'test-secret-at-least-this-long', bootstrapToken }) },
  })
  return { app, db, dbPath }
}

describe('otpAuth (CMS user auth)', () => {
  let email: ReturnType<typeof fakeEmail>
  let app: Awaited<ReturnType<typeof createTestApp>>['app']
  const dbPaths: string[] = []

  beforeEach(async () => {
    email = fakeEmail()
    const created = await createTestApp(email)
    app = created.app
    dbPaths.push(created.dbPath)
  })

  afterEach(async () => {
    while (dbPaths.length > 0) {
      const path = dbPaths.pop()!
      await Promise.all([path, `${path}-wal`, `${path}-shm`].map((p) => rm(p, { force: true })))
    }
  })

  it('blocks /collections/* without a session', async () => {
    const res = await app.request('/collections/posts')
    expect(res.status).toBe(401)
    expect((await readJson(res)).errors).toEqual([{ message: 'Not authenticated.' }])
  })

  it('bootstraps the first CMS user on an empty cms_users table, granting a session usable against /collections/*', async () => {
    const requestRes = await app.request('/auth/otp/request', json({ email: 'admin@example.com' }))
    expect(requestRes.status).toBe(200)
    expect(email.sent).toHaveLength(1)
    const code = codeFrom(email.sent[0]!)

    const verifyRes = await app.request('/auth/otp/verify', json({ email: 'admin@example.com', code }))
    expect(verifyRes.status).toBe(200)
    const verifyBody = await readJson(verifyRes)
    expect(verifyBody.user.email).toBe('admin@example.com')

    const cookie = cookieHeaderFrom(verifyRes)

    const me = await app.request('/auth/me', { headers: { cookie } })
    expect(me.status).toBe(200)
    expect((await readJson(me)).user.email).toBe('admin@example.com')

    const protectedRes = await app.request('/collections/posts', { headers: { cookie } })
    expect(protectedRes.status).toBe(200)
  })

  it('rejects a bootstrap verify missing the bootstrap token when one is configured', async () => {
    const created = await createTestApp(email, 'secret-token')
    app = created.app
    dbPaths.push(created.dbPath)

    await app.request('/auth/otp/request', json({ email: 'admin@example.com' }))
    const code = codeFrom(email.sent[0]!)

    const withoutToken = await app.request('/auth/otp/verify', json({ email: 'admin@example.com', code }))
    expect(withoutToken.status).toBe(401)

    const withToken = await app.request(
      '/auth/otp/verify',
      json({ email: 'admin@example.com', code }, { 'X-Oxygen-Bootstrap-Token': 'secret-token' }),
    )
    expect(withToken.status).toBe(200)
  })

  it('closes the bootstrap door after the first user, requiring the identity to already exist', async () => {
    await app.request('/auth/otp/request', json({ email: 'admin@example.com' }))
    const firstCode = codeFrom(email.sent[0]!)
    await app.request('/auth/otp/verify', json({ email: 'admin@example.com', code: firstCode }))

    // A second, never-seen-before email no longer gets a code at all (not an enumeration oracle)...
    const requestRes = await app.request('/auth/otp/request', json({ email: 'nobody@example.com' }))
    expect(requestRes.status).toBe(200)
    expect(email.sent).toHaveLength(1) // still just the bootstrap send

    // ...and even a directly-fabricated verify attempt is rejected, since no code was ever issued.
    const verifyRes = await app.request('/auth/otp/verify', json({ email: 'nobody@example.com', code: '000000' }))
    expect(verifyRes.status).toBe(401)
  })

  it('rejects an incorrect code, then locks out after too many attempts', async () => {
    await app.request('/auth/otp/request', json({ email: 'admin@example.com' }))

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/auth/otp/verify', json({ email: 'admin@example.com', code: '000000' }))
      expect(res.status).toBe(401)
    }

    const code = codeFrom(email.sent[0]!)
    const lockedRes = await app.request('/auth/otp/verify', json({ email: 'admin@example.com', code }))
    expect(lockedRes.status).toBe(401)
    expect((await readJson(lockedRes)).errors[0].message).toMatch(/too many/i)
  })

  it('logs out, revoking the session so /auth/me and protected routes 401 again', async () => {
    await app.request('/auth/otp/request', json({ email: 'admin@example.com' }))
    const code = codeFrom(email.sent[0]!)
    const verifyRes = await app.request('/auth/otp/verify', json({ email: 'admin@example.com', code }))
    const cookie = cookieHeaderFrom(verifyRes)

    const logoutRes = await app.request('/auth/logout', { method: 'POST', headers: { cookie } })
    expect(logoutRes.status).toBe(200)

    const me = await app.request('/auth/me', { headers: { cookie } })
    expect(me.status).toBe(401)

    const protectedRes = await app.request('/collections/posts', { headers: { cookie } })
    expect(protectedRes.status).toBe(401)
  })
})
