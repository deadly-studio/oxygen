import { Hono } from 'hono'
import type { Context } from 'hono'
import type { EmbeddedAsset } from './generated/assets.js'
import { assets } from './generated/assets.js'

export interface AdminUiOptions {
  /**
   * Overrides the web app's auto-detected API base path. By default the
   * bundle assumes it's served at `.../admin` relative to `oxygen()`'s own
   * mount point (`app.route('/cms/admin', adminUI())` when `oxygen()` is
   * mounted at `/cms`) and derives the API base from `window.location`
   * accordingly — see `web/src/api.ts`. Set this if you mount somewhere that
   * doesn't end in `/admin`.
   */
  apiBasePath?: string
}

const INDEX_KEY = 'index.html'

function decode(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * The mount path this exact request resolved through, always with a
 * trailing slash — e.g. `/cms/admin/` whether the request was for
 * `/cms/admin`, `/cms/admin/`, or a deep link like
 * `/cms/admin/collections/posts` (`requested` = `collections/posts`, so it's
 * stripped back off `c.req.path` to recover the mount path).
 */
function mountBase(c: Context, requested: string): string {
  const path = c.req.path
  const base = requested === '' ? path : path.slice(0, path.length - requested.length)
  return base.endsWith('/') ? base : `${base}/`
}

function serveIndex(c: Context, index: EmbeddedAsset, requested: string, options: AdminUiOptions): Response {
  const html = new TextDecoder().decode(decode(index.base64))
  // The built HTML references its assets with relative paths (`base: './'`
  // in web/vite.config.ts) so the same build works mounted at any depth —
  // but relative URL resolution depends on the *document's* URL having a
  // trailing slash to mean "this directory", which `/cms/admin` (no slash)
  // doesn't. A <base> tag pins resolution to the real mount path regardless
  // of which exact form of the URL the browser has.
  const configScript = options.apiBasePath
    ? `<script>window.__OXYGEN_ADMIN_CONFIG__=${JSON.stringify({ apiBasePath: options.apiBasePath })}</script>`
    : ''
  const injected = html.replace('<head>', `<head><base href="${mountBase(c, requested)}" />${configScript}`)
  return new Response(injected, { headers: { 'Content-Type': index.contentType } })
}

function serveAsset(asset: EmbeddedAsset): Response {
  return new Response(decode(asset.base64), { headers: { 'Content-Type': asset.contentType } })
}

/**
 * Serves the prebuilt admin UI as static assets embedded at build time (no
 * filesystem access at runtime, so this works the same in Node, Workers, and
 * Bun) — see docs/BUILD_PLAN.md#12-stretch-admin-ui. Any path not matching a
 * real built asset falls back to `index.html` so the SPA's own client-side
 * routing handles deep links (`/admin/collections/posts/abc`).
 */
export function adminUI(options: AdminUiOptions = {}): Hono {
  const app = new Hono()

  const serve = (c: Context, requested: string) => {
    const asset = requested === '' ? undefined : assets[requested]
    if (asset) return serveAsset(asset)

    const index = assets[INDEX_KEY]
    if (!index) return missingBuildResponse(c)
    return serveIndex(c, index, requested, options)
  }

  // Two routes, not one: mounted via `app.route('/admin', adminUI())`,
  // `/admin` (no trailing slash) only matches `/`, while `/admin/...` only
  // matches `/:path{.*}` (which needs the leading slash to fire at all) —
  // neither pattern alone covers both the bare mount path and every nested
  // path (including the empty '/admin/' case), confirmed empirically.
  app.get('/', (c) => serve(c, ''))
  app.get('/:path{.*}', (c) => serve(c, c.req.param('path')))

  return app
}

function missingBuildResponse(c: Context): Response {
  return c.text('@deadly-studio/oxygen-admin: no build found — run `pnpm build` in that package first.', 500)
}
