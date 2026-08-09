import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

function toBase64(text: string): string {
  return Buffer.from(text).toString('base64')
}

vi.mock('./generated/assets.js', () => ({
  assets: {
    'index.html': {
      contentType: 'text/html; charset=utf-8',
      base64: toBase64('<!doctype html><head></head><body>root</body></html>'),
    },
    'assets/app.js': {
      contentType: 'text/javascript; charset=utf-8',
      base64: toBase64('console.log(1)'),
    },
  },
}))

const { adminUI } = await import('./server.js')

function mount(app: Hono, prefix: string): Hono {
  const outer = new Hono()
  outer.route(prefix, app)
  return outer
}

describe('adminUI', () => {
  it('serves index.html at the bare mount root, with a <base> tag pinning relative asset resolution', async () => {
    const outer = mount(adminUI(), '/cms/admin')
    const res = await outer.request('/cms/admin')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('<base href="/cms/admin/" />')
  })

  it('serves index.html the same way with a trailing slash', async () => {
    const outer = mount(adminUI(), '/cms/admin')
    const res = await outer.request('/cms/admin/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<base href="/cms/admin/" />')
  })

  it('serves a real built asset by its key, verbatim', async () => {
    const outer = mount(adminUI(), '/cms/admin')
    const res = await outer.request('/cms/admin/assets/app.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/javascript')
    expect(await res.text()).toBe('console.log(1)')
  })

  it('falls back to index.html for an unrecognized deep link (SPA client-side routing)', async () => {
    const outer = mount(adminUI(), '/cms/admin')
    const res = await outer.request('/cms/admin/collections/posts/abc123')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('root')
    expect(body).toContain('<base href="/cms/admin/" />')
  })

  it('injects window.__OXYGEN_ADMIN_CONFIG__ when apiBasePath is set', async () => {
    const outer = mount(adminUI({ apiBasePath: '/custom-api' }), '/cms/admin')
    const res = await outer.request('/cms/admin')
    expect(await res.text()).toContain('window.__OXYGEN_ADMIN_CONFIG__={"apiBasePath":"/custom-api"}')
  })

  it('omits the config script when apiBasePath is not set', async () => {
    const outer = mount(adminUI(), '/cms/admin')
    const res = await outer.request('/cms/admin')
    expect(await res.text()).not.toContain('__OXYGEN_ADMIN_CONFIG__')
  })
})
