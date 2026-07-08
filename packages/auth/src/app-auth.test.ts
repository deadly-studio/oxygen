import { oxygen } from '@deadly-studio/oxygen'
import { buildSchema, defineCollection, text } from '@deadly-studio/oxygen-fields'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appOtpAuth } from './app-auth.js'
import { verifyAccessToken } from './app-tokens.js'
import { codeFrom, createTestDb, fakeEmail, postJson, readJson } from './test-helpers.js'

const JWT_SECRET = 'test-jwt-secret-at-least-this-long'

const Customers = defineCollection({
  slug: 'customers',
  auth: true,
  fields: { email: text().required().unique(), name: text() },
})

async function createTestApp(email: ReturnType<typeof fakeEmail>) {
  const { db, cleanup } = await createTestDb(buildSchema([{ slug: Customers.slug, fields: Customers.fields }]))
  const app = oxygen({
    db,
    collections: [Customers],
    auth: { app: appOtpAuth({ email, jwtSecret: JWT_SECRET }) },
  })
  return { app, cleanup }
}

describe('appOtpAuth (app user auth)', () => {
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

  it('always sends a code on request, even for an email never seen before (self-service signup)', async () => {
    const res = await app.request('/app/customers/auth/otp/request', postJson({ identifier: 'new@example.com' }))
    expect(res.status).toBe(200)
    expect(email.sent).toHaveLength(1)
  })

  it('signs a new customer up on first verify, returning a working access + refresh token pair', async () => {
    await app.request('/app/customers/auth/otp/request', postJson({ identifier: 'new@example.com' }))
    const code = codeFrom(email.sent[0]!)

    const verifyRes = await app.request('/app/customers/auth/otp/verify', postJson({ identifier: 'new@example.com', code }))
    expect(verifyRes.status).toBe(200)
    const body = await readJson(verifyRes)
    expect(body.user.email).toBe('new@example.com')
    expect(typeof body.accessToken).toBe('string')
    expect(typeof body.refreshToken).toBe('string')

    const payload = await verifyAccessToken(JWT_SECRET, body.accessToken)
    expect(payload).toEqual({ sub: body.user.id, slug: 'customers' })
  })

  it('reuses the same row on a second sign-in rather than creating a duplicate customer', async () => {
    await app.request('/app/customers/auth/otp/request', postJson({ identifier: 'repeat@example.com' }))
    const firstCode = codeFrom(email.sent[0]!)
    const first = await readJson(
      await app.request('/app/customers/auth/otp/verify', postJson({ identifier: 'repeat@example.com', code: firstCode })),
    )

    await app.request('/app/customers/auth/otp/request', postJson({ identifier: 'repeat@example.com' }))
    const secondCode = codeFrom(email.sent[1]!)
    const second = await readJson(
      await app.request('/app/customers/auth/otp/verify', postJson({ identifier: 'repeat@example.com', code: secondCode })),
    )

    expect(second.user.id).toBe(first.user.id)
  })

  it('rejects a garbage or wrongly-signed access token, and rejects nothing about which collection minted a valid one', async () => {
    await app.request('/app/customers/auth/otp/request', postJson({ identifier: 'new@example.com' }))
    const code = codeFrom(email.sent[0]!)
    const body = await readJson(
      await app.request('/app/customers/auth/otp/verify', postJson({ identifier: 'new@example.com', code })),
    )

    expect(await verifyAccessToken(JWT_SECRET, 'not-a-jwt')).toBeUndefined()
    expect(await verifyAccessToken('wrong-secret', body.accessToken)).toBeUndefined()
    // A caller that does care which collection minted the token compares payload.slug itself.
    const payload = await verifyAccessToken(JWT_SECRET, body.accessToken)
    expect(payload?.slug).toBe('customers')
  })

  it('rotates the refresh token, invalidating the old one', async () => {
    await app.request('/app/customers/auth/otp/request', postJson({ identifier: 'new@example.com' }))
    const code = codeFrom(email.sent[0]!)
    const { refreshToken } = await readJson(
      await app.request('/app/customers/auth/otp/verify', postJson({ identifier: 'new@example.com', code })),
    )

    const refreshRes = await app.request('/app/customers/auth/refresh', postJson({ refreshToken }))
    expect(refreshRes.status).toBe(200)
    const rotated = await readJson(refreshRes)
    expect(rotated.refreshToken).not.toBe(refreshToken)

    const reuseRes = await app.request('/app/customers/auth/refresh', postJson({ refreshToken }))
    expect(reuseRes.status).toBe(401)

    const withNewRes = await app.request('/app/customers/auth/refresh', postJson({ refreshToken: rotated.refreshToken }))
    expect(withNewRes.status).toBe(200)
  })

  it('logs out, revoking the refresh token so it can no longer be used to refresh', async () => {
    await app.request('/app/customers/auth/otp/request', postJson({ identifier: 'new@example.com' }))
    const code = codeFrom(email.sent[0]!)
    const { refreshToken } = await readJson(
      await app.request('/app/customers/auth/otp/verify', postJson({ identifier: 'new@example.com', code })),
    )

    const logoutRes = await app.request('/app/customers/auth/logout', postJson({ refreshToken }))
    expect(logoutRes.status).toBe(200)

    const refreshRes = await app.request('/app/customers/auth/refresh', postJson({ refreshToken }))
    expect(refreshRes.status).toBe(401)
  })
})

describe('oxygen() with an auth-enabled collection but no auth.app strategy configured', () => {
  it('throws at construction time rather than silently leaving the collection unauthenticatable', async () => {
    const { db, cleanup } = await createTestDb(buildSchema([{ slug: Customers.slug, fields: Customers.fields }]))
    try {
      expect(() => oxygen({ db, collections: [Customers] })).toThrow(/customers.*auth\.app/)
    } finally {
      await cleanup()
    }
  })
})
