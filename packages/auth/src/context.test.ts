import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { issueTokenPair } from './app-tokens.js'
import { getAppUser, getBearerToken } from './context.js'
import { createTestDb, readJson } from './test-helpers.js'

const JWT_SECRET = 'test-jwt-secret-at-least-this-long'

describe('getBearerToken', () => {
  it('extracts the token from an Authorization: Bearer header', async () => {
    const app = new Hono()
    app.get('/', (c) => c.json({ token: getBearerToken(c) ?? null }))
    const res = await app.request('/', { headers: { authorization: 'Bearer abc.def.ghi' } })
    expect((await readJson(res)).token).toBe('abc.def.ghi')
  })

  it('returns undefined when the header is missing', async () => {
    const app = new Hono()
    app.get('/', (c) => c.json({ token: getBearerToken(c) ?? null }))
    const res = await app.request('/')
    expect((await readJson(res)).token).toBeNull()
  })

  it('returns undefined for a non-Bearer scheme', async () => {
    const app = new Hono()
    app.get('/', (c) => c.json({ token: getBearerToken(c) ?? null }))
    const res = await app.request('/', { headers: { authorization: 'Basic dXNlcjpwYXNz' } })
    expect((await readJson(res)).token).toBeNull()
  })
})

describe('getAppUser', () => {
  it('resolves {sub, slug} from a valid access token', async () => {
    const { db, cleanup } = await createTestDb()
    try {
      const { accessToken } = await issueTokenPair(db, JWT_SECRET, { sub: 'user-1', slug: 'customers' })
      const app = new Hono()
      app.get('/', async (c) => c.json((await getAppUser(c, JWT_SECRET)) ?? null))
      const res = await app.request('/', { headers: { authorization: `Bearer ${accessToken}` } })
      expect(await readJson(res)).toEqual({ sub: 'user-1', slug: 'customers' })
    } finally {
      await cleanup()
    }
  })

  it('returns undefined with no Authorization header', async () => {
    const app = new Hono()
    app.get('/', async (c) => c.json((await getAppUser(c, JWT_SECRET)) ?? null))
    const res = await app.request('/')
    expect(await readJson(res)).toBeNull()
  })

  it('returns undefined for a token signed with a different secret', async () => {
    const { db, cleanup } = await createTestDb()
    try {
      const { accessToken } = await issueTokenPair(db, 'a-completely-different-secret-value', {
        sub: 'user-1',
        slug: 'customers',
      })
      const app = new Hono()
      app.get('/', async (c) => c.json((await getAppUser(c, JWT_SECRET)) ?? null))
      const res = await app.request('/', { headers: { authorization: `Bearer ${accessToken}` } })
      expect(await readJson(res)).toBeNull()
    } finally {
      await cleanup()
    }
  })

  it('returns undefined for a malformed token', async () => {
    const app = new Hono()
    app.get('/', async (c) => c.json((await getAppUser(c, JWT_SECRET)) ?? null))
    const res = await app.request('/', { headers: { authorization: 'Bearer not-a-real-jwt' } })
    expect(await readJson(res)).toBeNull()
  })
})
