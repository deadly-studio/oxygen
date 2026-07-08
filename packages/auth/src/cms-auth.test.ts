import { oxygen } from '@deadly-studio/oxygen'
import { buildSchema, defineCollection, text } from '@deadly-studio/oxygen-fields'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { otpAuth } from './cms-auth.js'
import { codeFrom, cookieHeaderFrom, createTestDb, fakeEmail, postJson, readJson } from './test-helpers.js'

const Posts = defineCollection({ slug: 'posts', fields: { title: text().required() } })

async function createTestApp(email: ReturnType<typeof fakeEmail>, bootstrapToken?: string) {
  const { db, cleanup } = await createTestDb(buildSchema([{ slug: Posts.slug, fields: Posts.fields }]))
  const app = oxygen({
    db,
    collections: [Posts],
    auth: { cms: otpAuth({ email, cookieSecret: 'test-secret-at-least-this-long', bootstrapToken }) },
  })
  return { app, cleanup }
}

describe('otpAuth (CMS user auth)', () => {
  let email: ReturnType<typeof fakeEmail>
  let app: Awaited<ReturnType<typeof createTestApp>>['app']
  const cleanups: (() => Promise<void>)[] = []

  beforeEach(async () => {
    email = fakeEmail()
    const created = await createTestApp(email)
    app = created.app
    cleanups.push(created.cleanup)
  })

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!()
  })

  it('blocks /collections/* without a session', async () => {
    const res = await app.request('/collections/posts')
    expect(res.status).toBe(401)
    expect((await readJson(res)).errors).toEqual([{ message: 'Not authenticated.' }])
  })

  it('bootstraps the first CMS user on an empty cms_users table, granting a session usable against /collections/*', async () => {
    const requestRes = await app.request('/auth/otp/request', postJson({ email: 'admin@example.com' }))
    expect(requestRes.status).toBe(200)
    expect(email.sent).toHaveLength(1)
    const code = codeFrom(email.sent[0]!)

    const verifyRes = await app.request('/auth/otp/verify', postJson({ email: 'admin@example.com', code }))
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
    cleanups.push(created.cleanup)

    await app.request('/auth/otp/request', postJson({ email: 'admin@example.com' }))
    const code = codeFrom(email.sent[0]!)

    const withoutToken = await app.request('/auth/otp/verify', postJson({ email: 'admin@example.com', code }))
    expect(withoutToken.status).toBe(401)

    const withToken = await app.request(
      '/auth/otp/verify',
      postJson({ email: 'admin@example.com', code }, { 'X-Oxygen-Bootstrap-Token': 'secret-token' }),
    )
    expect(withToken.status).toBe(200)
  })

  it('closes the bootstrap door after the first user, requiring the identity to already exist', async () => {
    await app.request('/auth/otp/request', postJson({ email: 'admin@example.com' }))
    const firstCode = codeFrom(email.sent[0]!)
    await app.request('/auth/otp/verify', postJson({ email: 'admin@example.com', code: firstCode }))

    // A second, never-seen-before email no longer gets a code at all (not an enumeration oracle)...
    const requestRes = await app.request('/auth/otp/request', postJson({ email: 'nobody@example.com' }))
    expect(requestRes.status).toBe(200)
    expect(email.sent).toHaveLength(1) // still just the bootstrap send

    // ...and even a directly-fabricated verify attempt is rejected, since no code was ever issued.
    const verifyRes = await app.request('/auth/otp/verify', postJson({ email: 'nobody@example.com', code: '000000' }))
    expect(verifyRes.status).toBe(401)
  })

  it('rejects an incorrect code, then locks out after too many attempts', async () => {
    await app.request('/auth/otp/request', postJson({ email: 'admin@example.com' }))

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/auth/otp/verify', postJson({ email: 'admin@example.com', code: '000000' }))
      expect(res.status).toBe(401)
    }

    const code = codeFrom(email.sent[0]!)
    const lockedRes = await app.request('/auth/otp/verify', postJson({ email: 'admin@example.com', code }))
    expect(lockedRes.status).toBe(401)
    expect((await readJson(lockedRes)).errors[0].message).toMatch(/too many/i)
  })

  it('logs out, revoking the session so /auth/me and protected routes 401 again', async () => {
    await app.request('/auth/otp/request', postJson({ email: 'admin@example.com' }))
    const code = codeFrom(email.sent[0]!)
    const verifyRes = await app.request('/auth/otp/verify', postJson({ email: 'admin@example.com', code }))
    const cookie = cookieHeaderFrom(verifyRes)

    const logoutRes = await app.request('/auth/logout', { method: 'POST', headers: { cookie } })
    expect(logoutRes.status).toBe(200)

    const me = await app.request('/auth/me', { headers: { cookie } })
    expect(me.status).toBe(401)

    const protectedRes = await app.request('/collections/posts', { headers: { cookie } })
    expect(protectedRes.status).toBe(401)
  })
})
