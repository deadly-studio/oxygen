# oxygen — getting started

A walkthrough of wiring oxygen into a real Hono app: install, define collections, mount it, turn on
auth/permissions/storage/webhooks, and access oxygen's auth context from your own routes mounted
alongside it. Every snippet here matches a real, tested API — see [`docs/BUILD_PLAN.md`](./BUILD_PLAN.md)
for *why* things are shaped this way and [`docs/SPEC.md`](./SPEC.md) for the exact route/field contract.
[`examples/basic`](../examples/basic) is this guide as a runnable app.

## Install

```sh
pnpm add @deadly-studio/oxygen @deadly-studio/oxygen-fields drizzle-orm
# pick the pieces you need:
pnpm add @deadly-studio/oxygen-auth @deadly-studio/oxygen-email   # CMS/app-user auth
pnpm add @deadly-studio/oxygen-permissions                        # roles/permissions
pnpm add @deadly-studio/oxygen-storage                             # S3/local upload adapters
pnpm add @deadly-studio/oxygen-client                              # typed REST client, for your frontend
pnpm add -D drizzle-kit @libsql/client                             # or better-sqlite3 / bun:sqlite / D1
```

Every package name above is unpublished as of this writing (`private: true` in the monorepo) — until a
release, consume this from a workspace/local link, per [`README.md`](../README.md#status).

## Define collections and singles

```ts
// collections.ts
import { defineCollection, defineSingle, relation, richText, select, text, timestamp, upload } from '@deadly-studio/oxygen-fields'

export const Posts = defineCollection({
  slug: 'posts',
  fields: {
    title: text().required(),
    body: richText(),
    status: select(['draft', 'published']).default('draft'),
    publishedAt: timestamp(),
    author: relation('customers'),
    cover: upload(),
  },
})

export const Customers = defineCollection({
  slug: 'customers',
  auth: true, // opts this collection into its own OTP+JWT login namespace — see "App user auth" below
  fields: {
    email: text().required().unique(), // required by app-user auth's self-service signup
    name: text(),
  },
})

export const SiteSettings = defineSingle({
  slug: 'site-settings',
  fields: { supportEmail: text().required() },
})
```

## Migrations

`packages/fields`' `buildSchema()` is the one place collection/single definitions turn into real Drizzle
tables (see [`docs/FIELDS.md`](./FIELDS.md#translation-layer-contract)); `oxygen()` calls it internally.
Merge in whichever framework packages you're using — `cmsAuthTables` (`@deadly-studio/oxygen-auth`),
`permissionsTables` (`@deadly-studio/oxygen-permissions`), `webhookTables` (`@deadly-studio/oxygen`) — so
their tables get created too:

```ts
// schema.ts
import { buildSchema } from '@deadly-studio/oxygen-fields'
import { cmsAuthTables } from '@deadly-studio/oxygen-auth'
import { permissionsTables } from '@deadly-studio/oxygen-permissions'
import { webhookTables } from '@deadly-studio/oxygen'
import { Customers, Posts, SiteSettings } from './collections.js'

export const tables = {
  ...buildSchema([
    { slug: Posts.slug, fields: Posts.fields },
    { slug: Customers.slug, fields: Customers.fields },
    { slug: SiteSettings.slug, fields: SiteSettings.fields },
  ]),
  ...cmsAuthTables,
  ...permissionsTables,
  ...webhookTables,
}
```

For **dev**, `drizzle-kit/api`'s programmatic `pushSQLiteSchema` diffs that straight against the live
database — no migration files, same thing every test in this repo uses to spin up a schema:

```ts
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { db } from './db.js'
import { tables } from './schema.js'

const { apply } = await pushSQLiteSchema(tables, db)
await apply()
```

For **generating real migration files** in something closer to production, `drizzle-kit/api` also exports
`generateSQLiteDrizzleJson`/`generateSQLiteMigration` for scripting that yourself today. A packaged
`oxygen generate` CLI that wraps this (and the drizzle-kit CLI's own `generate`/`migrate` commands) is
designed in [`docs/SPEC.md`](./SPEC.md#schema--migrations) but not built yet.

## Mount it

```ts
// app.ts
import { Hono } from 'hono'
import { oxygen } from '@deadly-studio/oxygen'
import { db } from './db.js' // any Drizzle SQLite client — see docs/BUILD_PLAN.md#3-database-driver
import { Customers, Posts, SiteSettings } from './collections.js'

export const cms = oxygen({
  db,
  collections: [Posts, Customers],
  singles: [SiteSettings],
})

const app = new Hono()
app.route('/cms', cms)
export default app
```

At this point `GET/POST /cms/collections/posts`, `GET/PATCH /cms/singles/site-settings`, etc. are live —
see [`docs/SPEC.md`](./SPEC.md#generated-rest-api) for the full generated surface — with **no auth or
permission enforcement** until you configure them below (matches every phase's "unconfigured = unrestricted"
default).

## CMS user auth (OTP + cookies)

```ts
import { otpAuth } from '@deadly-studio/oxygen-auth'
import { resendAdapter } from '@deadly-studio/oxygen-email'

const cms = oxygen({
  db,
  collections: [Posts, Customers],
  auth: {
    cms: otpAuth({
      email: resendAdapter({ apiKey: process.env.RESEND_API_KEY!, from: 'cms@yourapp.com' }),
      cookieSecret: process.env.CMS_COOKIE_SECRET!, // long, random, unique to this deployment
    }),
  },
})
```

This adds `POST /cms/auth/otp/request`, `POST /cms/auth/otp/verify`, `POST /cms/auth/logout`,
`GET /cms/auth/me`, and gates `/cms/collections/*`/`/cms/singles/*` behind a valid session — see
[`docs/SPEC.md`](./SPEC.md#cms-user-auth-otp--cookie-sessions). While `cms_users` is empty, **any** email
can verify and becomes the first user, granted the built-in super-admin role
([bootstrap flow](./SPEC.md#bootstrapping-the-first-cms-user)) — lock this down with
`otpAuth({ bootstrapToken: '...' })` if the deployment might be publicly reachable before you've claimed
that first account.

## App user auth (OTP + JWT)

Any collection with `auth: true` (like `Customers` above) needs `auth.app` configured once — it covers
every auth-enabled collection, each getting its own login namespace:

```ts
import { appOtpAuth } from '@deadly-studio/oxygen-auth'

const cms = oxygen({
  db,
  collections: [Posts, Customers],
  auth: {
    cms: otpAuth({ /* ... */ }),
    app: appOtpAuth({
      email: resendAdapter({ apiKey: process.env.RESEND_API_KEY!, from: 'app@yourapp.com' }),
      jwtSecret: process.env.APP_JWT_SECRET!,
    }),
  },
})
```

This adds `POST /cms/app/customers/auth/otp/{request,verify}`, `/refresh`, `/logout` — self-service: any
email can sign up, creating a `customers` row on first verify (docs/SPEC.md#app-user-auth-otp--jwt). Verify
returns `{ accessToken, refreshToken, user }`; the frontend sends `Authorization: Bearer <accessToken>` on
every subsequent request.

## Permissions

```ts
import { rolePermissions } from '@deadly-studio/oxygen-permissions'

const cms = oxygen({
  db,
  collections: [Posts, Customers],
  auth: { cms: otpAuth({ /* ... */ }), app: appOtpAuth({ /* ... */ }) },
  permissions: rolePermissions({
    cookieSecret: process.env.CMS_COOKIE_SECRET!, // must match otpAuth's
    jwtSecret: process.env.APP_JWT_SECRET!,        // must match appOtpAuth's
  }),
})
```

Deny-by-default once this is configured: a role needs an explicit `cms_permissions` row for
`(resource, action)` or every request from that role 403s, except the super-admin role, which bypasses
everything (docs/SPEC.md#permissions). App users get an implicit `self` role for free.

**Current gap**: the REST admin surface for managing roles/permissions
([`docs/SPEC.md`](./SPEC.md#managing-roles--permissions)) isn't built yet — grant access by inserting rows
directly for now, using the tables `@deadly-studio/oxygen-auth` (`cmsRoles`, `cmsUserRoles`) and
`@deadly-studio/oxygen-permissions` (`cmsPermissions`) both export:

```ts
import { eq } from 'drizzle-orm'
import { cmsRoles, cmsUserRoles } from '@deadly-studio/oxygen-auth'
import { cmsPermissions } from '@deadly-studio/oxygen-permissions'
import { ulid } from '@deadly-studio/oxygen'

const editor = { id: ulid(), name: 'editor' }
await db.insert(cmsRoles).values(editor)
await db.insert(cmsUserRoles).values({ userId: someCmsUserId, roleId: editor.id })
await db.insert(cmsPermissions).values({
  id: ulid(),
  roleId: editor.id,
  resource: 'posts',
  action: 'update',
  scope: { author: '$currentUser' }, // same filter grammar as ?where= — docs/SPEC.md#query-dsl-list-endpoint
  fields: null, // null = every field allowed
})
```

## Storage (uploads)

```ts
import { s3Storage } from '@deadly-studio/oxygen-storage'

const cms = oxygen({
  db,
  collections: [Posts],
  storage: s3Storage({
    bucket: 'my-app-uploads',
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT, // omit for real AWS S3; set for R2/other S3-compatible services
    forcePathStyle: true,              // R2 and most S3-compatible services need this
  }),
})
```

Flow for an `upload()` field like `Posts.cover` (docs/SPEC.md#storage): `POST /cms/collections/posts/
upload-url` with `{ filename, contentType }` → `{ uploadUrl, key }`; the client `PUT`s the file straight to
`uploadUrl` (bypassing oxygen entirely); then `POST`/`PATCH` the document with
`cover: { key, filename, mimeType, filesize }`. For local dev without a bucket, swap in `localStorage()`
(`@deadly-studio/oxygen-storage`), which serves the upload/download routes itself — see its `baseUrl` option
for the one thing you have to get right (it has to match wherever `oxygen()` ends up mounted).

A collection with more than one `upload()` field needs `field` in the `upload-url` request body to say
which one; `upload('slug')` picks which configured adapter to use if `storage` is a `{ slug: adapter }` map
instead of a single adapter.

## Webhooks

```ts
import { webhook } from '@deadly-studio/oxygen'

export const Posts = defineCollection({
  slug: 'posts',
  fields: { /* ... */ },
  hooks: {
    afterChange: [webhook({ url: 'https://yourapp.com/webhooks/posts', secret: process.env.WEBHOOK_SECRET! })],
  },
})
```

Verify deliveries with the `X-Oxygen-Signature: sha256=<hmac>` header (docs/SPEC.md#webhooks). A failed
delivery persists and backs off (1m/5m/15m/1h/6h) — since oxygen is a library, not a standalone server, wire
its retry into your own scheduler:

```ts
import { processWebhookDeliveries } from '@deadly-studio/oxygen'

// e.g. a cron hitting an endpoint that calls this, once a minute
await processWebhookDeliveries(db)
```

## Typed client

For your frontend (or any external caller):

```ts
import { createClient } from '@deadly-studio/oxygen-client'
import type { Customers, Posts, SiteSettings } from './collections.js'

const client = createClient<{ posts: typeof Posts; customers: typeof Customers; 'site-settings': typeof SiteSettings }>({
  baseUrl: 'https://yourapp.com/cms',
})

const { docs } = await client.collection('posts').find({ where: { status: 'published' }, sort: '-publishedAt' })
await client.auth.app('customers').otp.request('someone@example.com')
```

See [`packages/client`](../packages/client) — `TResources` is a type parameter only; no collection/single
objects need to reach the client at runtime.

## Custom routes

Because `oxygen()` just returns a `Hono` instance, bespoke routes sit right alongside it — "use Hono like
you already do" (docs/BUILD_PLAN.md#4-the-hono-mount-point). `db` is already in scope (you passed it into
`oxygen()` yourself); to identify *who's calling* your own route, `@deadly-studio/oxygen-auth` exports the
same primitives oxygen's own permission layer uses internally:

```ts
import { Hono } from 'hono'
import { getAppUser, resolveSessionUser } from '@deadly-studio/oxygen-auth'
import { db } from './db.js'
import { cms } from './app.js'

const custom = new Hono()

custom.get('/me/orders', async (c) => {
  // getAppUser only verifies the bearer token — it returns { sub, slug },
  // not a hydrated row. You already have your own collection's table, so
  // look the row up yourself if you need more than the id.
  const appUser = await getAppUser(c, process.env.APP_JWT_SECRET!)
  if (!appUser) return c.json({ message: 'Not authenticated.' }, 401)
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.customerId, appUser.sub)).all()
  return c.json({ orders })
})

custom.get('/admin/stats', async (c) => {
  const cmsUser = await resolveSessionUser(c, db, process.env.CMS_COOKIE_SECRET!)
  if (!cmsUser) return c.json({ message: 'Not authenticated.' }, 401)
  return c.json({ email: cmsUser.email /* ... */ })
})

const app = new Hono()
app.route('/cms', cms)
app.route('/api', custom)
```

Both helpers just verify — they don't gate access on their own. To *require* auth the same way oxygen's own
CRUD routes do, reuse the same middleware:

```ts
import { otpAuth } from '@deadly-studio/oxygen-auth'

const auth = otpAuth({ /* ... */ })
custom.use('/admin/*', auth.middleware(db))
```

## Known gaps (as of phase 11)

- No REST admin surface for roles/permissions yet ([`docs/SPEC.md`](./SPEC.md#managing-roles--permissions))
  — manage `cms_roles`/`cms_user_roles`/`cms_permissions` directly, per the Permissions section above.
- No `oxygen generate` CLI yet — call `buildSchema()` yourself, per the Migrations section above.
- No admin UI (phase 12, stretch, per [`docs/BUILD_PLAN.md`](./BUILD_PLAN.md#phased-build-order)).
