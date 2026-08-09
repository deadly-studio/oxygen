import { Hono } from 'hono'
import { oxygen } from '@deadly-studio/oxygen'
import { appOtpAuth, getAppUser, otpAuth, resolveSessionUser } from '@deadly-studio/oxygen-auth'
import { localStorage } from '@deadly-studio/oxygen-storage'
import { Customers, Posts, SiteSettings } from './collections.js'
import { db } from './db/index.js'
import { consoleEmail } from './email.js'

// Dev-only fallbacks so `pnpm dev` works with zero setup, same spirit as the
// Turso/local-file db fallback below — set real secrets via env for anything
// beyond your own machine.
export const COOKIE_SECRET = process.env.CMS_COOKIE_SECRET ?? 'dev-only-cms-cookie-secret-change-me'
export const JWT_SECRET = process.env.APP_JWT_SECRET ?? 'dev-only-app-jwt-secret-change-me'
export const PORT = Number(process.env.PORT ?? 3000)

export const cms = oxygen({
  db,
  collections: [Posts, Customers],
  singles: [SiteSettings],
  auth: {
    cms: otpAuth({ email: consoleEmail, cookieSecret: COOKIE_SECRET }),
    app: appOtpAuth({ email: consoleEmail, jwtSecret: JWT_SECRET }),
  },
  storage: localStorage({ dir: './uploads', baseUrl: `http://localhost:${PORT}/cms/storage/default` }),
  // Deny-by-default RBAC — omitted here so this example stays usable without
  // seeding role/permission rows first. See docs/GUIDE.md#permissions for
  // how to turn it on:
  //   permissions: rolePermissions({ cookieSecret: COOKIE_SECRET, jwtSecret: JWT_SECRET }),
})

// A custom route mounted alongside oxygen() — see docs/GUIDE.md#custom-routes.
// `db` is already in scope; `getAppUser`/`resolveSessionUser` identify who's
// calling using the same primitives oxygen's own permission layer would.
const custom = new Hono()

custom.get('/whoami', async (c) => {
  const cmsUser = await resolveSessionUser(c, db, COOKIE_SECRET)
  if (cmsUser) return c.json({ kind: 'cms', email: cmsUser.email })

  const appUser = await getAppUser(c, JWT_SECRET)
  if (appUser) return c.json({ kind: 'app', sub: appUser.sub, slug: appUser.slug })

  return c.json({ message: 'Not authenticated.' }, 401)
})

export const app = new Hono()
app.route('/cms', cms)
app.route('/api', custom)
