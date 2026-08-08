import { defineCollection, defineSingle, group, relation, select, text } from '@deadly-studio/oxygen-fields'
import { describe, expect, it } from 'vitest'
import { ApiRequestError } from './http.js'
import { createClient } from './client.js'
import type { FetchLike } from './http.js'

const Posts = defineCollection({
  slug: 'posts',
  fields: {
    title: text().required(),
    status: select(['draft', 'published']),
    author: relation('customers'),
    hero: group({ heading: text() }),
  },
})

const Customers = defineCollection({
  slug: 'customers',
  fields: { email: text().required().unique() },
  auth: true,
})

const SiteSettings = defineSingle({
  slug: 'site-settings',
  fields: { supportEmail: text().required() },
})

type Resources = { posts: typeof Posts; customers: typeof Customers; 'site-settings': typeof SiteSettings }

interface FakeCall {
  url: string
  init: RequestInit
}

function fakeFetch(responses: { status?: number; body?: unknown }[]): { fetch: FetchLike; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  let i = 0
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    const status = r?.status ?? 200
    const body = r?.body !== undefined ? JSON.stringify(r.body) : ''
    return new Response(body, { status })
  }) as FetchLike
  return { fetch: fetchImpl, calls }
}

describe('CollectionClient', () => {
  it('find() builds the query string from where/sort/limit/page', async () => {
    const { fetch, calls } = fakeFetch([{ body: { docs: [], totalDocs: 0 } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    await client.collection('posts').find({ where: { title: 'x' }, sort: ['-title', 'id'], limit: 5, page: 2 })

    const url = new URL(calls[0]!.url)
    expect(url.pathname).toBe('/collections/posts')
    expect(url.searchParams.get('where')).toBe(JSON.stringify({ title: 'x' }))
    expect(url.searchParams.get('sort')).toBe('-title,id')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('page')).toBe('2')
    expect(calls[0]!.init.method).toBe('GET')
  })

  it('findById() hits /collections/:slug/:id', async () => {
    const { fetch, calls } = fakeFetch([{ body: { id: 'abc' } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    await client.collection('posts').findById('abc')
    expect(new URL(calls[0]!.url).pathname).toBe('/collections/posts/abc')
  })

  it('create() POSTs the body and unwraps .doc', async () => {
    const { fetch, calls } = fakeFetch([{ status: 201, body: { message: 'created', doc: { id: '1', title: 'x' } } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    const doc = await client.collection('posts').create({ title: 'x' })
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ title: 'x' })
    expect(doc).toEqual({ id: '1', title: 'x' })
  })

  it('update() PATCHes /collections/:slug/:id and unwraps .doc', async () => {
    const { fetch, calls } = fakeFetch([{ body: { message: 'updated', doc: { id: '1', title: 'y' } } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    const doc = await client.collection('posts').update('1', { title: 'y' })
    expect(calls[0]!.init.method).toBe('PATCH')
    expect(new URL(calls[0]!.url).pathname).toBe('/collections/posts/1')
    expect(doc).toEqual({ id: '1', title: 'y' })
  })

  it('delete() sends DELETE and returns the message', async () => {
    const { fetch, calls } = fakeFetch([{ body: { message: 'posts deleted.' } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    const result = await client.collection('posts').delete('1')
    expect(calls[0]!.init.method).toBe('DELETE')
    expect(result).toEqual({ message: 'posts deleted.' })
  })

  it('fieldOptions() hits /collections/:slug/fields/:field/options', async () => {
    const { fetch, calls } = fakeFetch([{ body: { options: [{ value: 'draft', label: 'draft' }] } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    const result = await client.collection('posts').fieldOptions('status', { search: 'dr', limit: 5 })
    const url = new URL(calls[0]!.url)
    expect(url.pathname).toBe('/collections/posts/fields/status/options')
    expect(url.searchParams.get('search')).toBe('dr')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(result.options).toEqual([{ value: 'draft', label: 'draft' }])
  })

  it('throws ApiRequestError carrying the server error envelope on non-2xx', async () => {
    const { fetch } = fakeFetch([{ status: 400, body: { errors: [{ field: 'title', message: 'title is required.' }] } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    await expect(client.collection('posts').create({} as never)).rejects.toMatchObject({
      status: 400,
      errors: [{ field: 'title', message: 'title is required.' }],
    })
    await expect(client.collection('posts').create({} as never)).rejects.toBeInstanceOf(ApiRequestError)
  })
})

describe('SingleClient', () => {
  it('get() hits /singles/:slug', async () => {
    const { fetch, calls } = fakeFetch([{ body: { id: 'singleton', supportEmail: 'a@b.com' } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    await client.single('site-settings').get()
    expect(new URL(calls[0]!.url).pathname).toBe('/singles/site-settings')
    expect(calls[0]!.init.method).toBe('GET')
  })

  it('update() PATCHes /singles/:slug and unwraps .doc', async () => {
    const { fetch, calls } = fakeFetch([{ body: { message: 'updated', doc: { supportEmail: 'c@d.com' } } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    const doc = await client.single('site-settings').update({ supportEmail: 'c@d.com' })
    expect(calls[0]!.init.method).toBe('PATCH')
    expect(doc).toEqual({ supportEmail: 'c@d.com' })
  })
})

describe('auth.cms', () => {
  it('otp.request/verify, logout, me hit the right paths with the right bodies', async () => {
    const { fetch, calls } = fakeFetch([
      { body: { message: 'sent' } },
      { body: { user: { id: '1', email: 'a@b.com' } } },
      { body: { message: 'Logged out.' } },
      { body: { user: { id: '1', email: 'a@b.com' } } },
    ])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })

    await client.auth.cms.otp.request('a@b.com')
    expect(new URL(calls[0]!.url).pathname).toBe('/auth/otp/request')
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ email: 'a@b.com' })

    await client.auth.cms.otp.verify('a@b.com', '123456')
    expect(new URL(calls[1]!.url).pathname).toBe('/auth/otp/verify')
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ email: 'a@b.com', code: '123456' })

    await client.auth.cms.logout()
    expect(new URL(calls[2]!.url).pathname).toBe('/auth/logout')

    await client.auth.cms.me()
    expect(new URL(calls[3]!.url).pathname).toBe('/auth/me')
  })
})

describe('auth.app', () => {
  it('namespaces every route under /app/:slug/auth', async () => {
    const { fetch, calls } = fakeFetch([
      { body: { message: 'sent' } },
      { body: { accessToken: 'a', refreshToken: 'r', user: { id: '1' } } },
      { body: { accessToken: 'a2', refreshToken: 'r2' } },
      { body: { message: 'Logged out.' } },
    ])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    const app = client.auth.app('customers')

    await app.otp.request('c@d.com')
    expect(new URL(calls[0]!.url).pathname).toBe('/app/customers/auth/otp/request')
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ identifier: 'c@d.com' })

    const verified = await app.otp.verify('c@d.com', '123456')
    expect(new URL(calls[1]!.url).pathname).toBe('/app/customers/auth/otp/verify')
    expect(verified).toEqual({ accessToken: 'a', refreshToken: 'r', user: { id: '1' } })

    await app.refresh('r')
    expect(new URL(calls[2]!.url).pathname).toBe('/app/customers/auth/refresh')

    await app.logout('r')
    expect(new URL(calls[3]!.url).pathname).toBe('/app/customers/auth/logout')
  })
})

describe('createClient options', () => {
  it('sends credentials: include by default', async () => {
    const { fetch, calls } = fakeFetch([{ body: { user: null } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch })
    await client.auth.cms.me()
    expect(calls[0]!.init.credentials).toBe('include')
  })

  it('threads a static accessToken as a Bearer header', async () => {
    const { fetch, calls } = fakeFetch([{ body: { docs: [] } }])
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch, accessToken: 'tok-1' })
    await client.collection('posts').find()
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
  })

  it('re-reads a function accessToken on every request', async () => {
    const { fetch, calls } = fakeFetch([{ body: {} }, { body: {} }])
    let token = 'first'
    const client = createClient<Resources>({ baseUrl: 'http://api.test', fetch, accessToken: () => token })
    await client.collection('posts').findById('1')
    token = 'second'
    await client.collection('posts').findById('1')
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer first')
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe('Bearer second')
  })
})
