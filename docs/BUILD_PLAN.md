# oxygen — build plan

## What it is

A code-first CMS package that mounts into an existing Hono app, the way you'd mount any other Hono sub-app. Not a standalone server/admin binary — you `npm install` it, define collections in TypeScript, and get a REST API, auth, storage, and webhooks wired up against your own SQLite database.

Closest reference point is Payload CMS's config-as-code model, but embedded rather than owning the whole app, and SQLite/Drizzle instead of Mongo/Postgres-first.

## Non-goals (for now)

- No hosted admin UI in v1 — REST API + typed client first, admin panel is a later phase.
- No multi-database support — SQLite via Drizzle only, to start.
- No GraphQL.

## Core concepts

### 1. Collections (schema-as-code)

Consumers define collections in TypeScript; oxygen turns them into Drizzle table schemas plus generated REST CRUD routes.

```ts
// example shape, not final API
const Posts = defineCollection({
  slug: 'posts',
  fields: {
    title: text().required(),
    body: richText(),
    publishedAt: timestamp(),
    author: relation('users'),
  },
  auth: false,       // true for the users collection
  hooks: {
    afterChange: [notifyWebhooks],
  },
})
```

Drizzle schema + drizzle-kit migrations are generated/derived from this config, so there's one source of truth instead of hand-maintained schema files fighting hand-maintained config.

The field system is its own layer, decoupled from Drizzle's column types rather than a thin pass-through — Payload-style: conditional fields, nested groups/arrays, relation and upload fields, and validation that isn't just "whatever the column type implies." A translation layer maps oxygen field definitions down to Drizzle columns + drizzle-kit migrations; the field system itself doesn't know about Drizzle. More upfront work than a thin wrapper, but avoids getting boxed in by SQLite/Drizzle's column primitives once fields get more expressive (arrays, conditionals, groups).

### 2. Singles (singleton documents)

Alongside collections, `defineSingle` covers content that only ever has one instance — site settings, homepage content, nav menus. Same field system and Drizzle translation layer as collections, just a different route generator and storage shape: one row, seeded at migration time, never created or deleted through the API.

```ts
const SiteSettings = defineSingle({
  slug: 'site-settings',
  fields: {
    homepageHero: group({ heading: text(), image: upload('media') }),
    supportEmail: text().required(),
  },
})
```

REST surface is deliberately narrower than collections: `/cms/singles/:slug` exposes GET/PATCH only — no list, no id-based routes, no create/delete. Hooks, auth, and webhooks all work identically to collections since it's the same underlying machinery.

### 3. Database driver

`oxygen({ db, ... })` takes a Drizzle client, not a specific SQLite driver — Drizzle's SQLite dialect works the same whether that client wraps `better-sqlite3`, `bun:sqlite`, `@libsql/client` (Turso), or Cloudflare D1. oxygen itself has no dependency on any one of them.

Recommended default for docs/the example app: **Turso**. It speaks HTTP/websocket rather than needing a local file handle, so it works in edge/serverless runtimes (Cloudflare Workers, Vercel Edge) where `better-sqlite3`'s native bindings can't run — and it's a first-class Drizzle target. Since it's not yet decided whether oxygen needs to run on an edge runtime, this stays a recommendation rather than a hard dependency; for a plain long-running Node/Bun server, local file SQLite is simpler and has no network round-trip. Worth revisiting once a real deployment target is picked — if edge turns out to be in scope, add an early integration test against a Workers-like environment so the driver-agnostic boundary doesn't rot.

### 4. The Hono mount point

```ts
import { Hono } from 'hono'
import { oxygen } from '@deadly-studio/oxygen'

const app = new Hono()
const cms = oxygen({
  db,                 // any Drizzle SQLite client — better-sqlite3, libsql/Turso, D1, bun:sqlite
  collections: [Posts, Users],
  singles: [SiteSettings],
  storage: s3Storage({ bucket, region }),
  auth: { cms: otpAuth(), app: otpAuth() },
})

app.route('/cms', cms)
app.route('/api/custom-thing', myOwnRouter) // untouched, just Hono
```

Because it's just a Hono instance under the hood, adding bespoke routes alongside the generated CRUD routes is "use Hono like you already do" — no plugin API to learn for that part.

### 5. Two auth domains

- **CMS users** — people editing content in the admin/API (internal staff). Session-based, **signed httpOnly cookies**. CMS admin is always a browser context, so cookies are the simplest and safest fit — no token storage/XSS concerns, revocation is a DB row delete.
- **App users** — the consuming application's end users, who authenticate against the same CMS to read/write their own scoped data. **Bearer JWT, access + refresh pair.** These consumers span mobile apps, SPAs, and server-to-server calls, where cookies travel poorly across origins/platforms.

Both support OTP (email first, SMS later) as the primary flow, with password as a fallback strategy behind the same interface. Auth is pluggable (strategy interface) so OTP isn't hardcoded in — but it's the one we build and dogfood first.

OTP delivery itself goes through an **email adapter interface** — same pattern as storage. Ship a Resend adapter first (best DX for a new project), then Postmark and SES adapters as the interface stabilizes. Consumers can bring their own adapter if none of the built-ins fit.

### 6. Permissions

Roles and permissions live in tables, not scattered access-control functions — the clunky part of Payload's model is that "what can role X do" means grepping every collection file, and any change needs a redeploy. Data-driven means it's listable, editable, and auditable at runtime.

```
cms_roles           (id, name)
cms_user_roles      (userId, roleId)               -- many-to-many; a user can hold multiple roles
cms_permissions     (id, roleId, resource, action, scope, fields)
  resource: a collection or single slug
  action:   create | read | update | delete
  scope:    JSON filter, same shape as the list-query filter DSL from the query layer — null = unrestricted, e.g. { authorId: '$currentUser' }
  fields:   allow-list of field slugs — null = all fields
```

No bespoke rules language: **row-level scoping reuses the exact filter DSL the query layer already needs for `?where=` on list endpoints** — a permission's `scope` gets ANDed into every query for that role, same code path as user-supplied filters, just not optional. Field-level is a plain allow-list intersected into the response shape (read) and the accepted payload (write) — no per-field functions to write.

Applies uniformly to **both auth domains**: CMS staff roles (e.g. "editor" can update `posts` but only ones where `authorId = $currentUser`) and app users (e.g. a default "self" role scoping every action on `orders` to `userId = $currentUser`). One mechanism, two audiences.

Default posture is **deny by default**: no matching permission row for a given role + resource + action means no access, full stop — except a built-in super-admin role that bypasses the permission check entirely. Adding a new collection or single can't accidentally expose it; it starts locked down until a role is explicitly granted access.

Row-level scope and field-level allow-lists both live in the schema from the first pass, even though early roles may only use the coarse collection/action grant — avoids a breaking migration later to add columns that should've been there from day one.

### 7. Query layer

Every collection gets generated REST endpoints (list/get/create/update/delete) with filtering, sorting, and pagination via query params. A thin typed client wraps these endpoints so consuming apps get autocomplete against their own collection definitions instead of hand-rolled fetch calls.

### 8. Webhooks

Collection-level lifecycle hooks (`afterChange`, `afterDelete`, etc.) can dispatch signed HTTP webhooks (HMAC signature header) to configured endpoints, with retry/backoff.

### 9. Storage

Pluggable storage interface; S3 (or S3-compatible, e.g. R2) adapter first, local-disk adapter for dev. Upload fields on a collection get presigned-URL upload flow + metadata stored in SQLite.

### 10. Admin UI

Ships as prebuilt static assets bundled with the package and mounted via Hono (`serveStatic` at e.g. `/cms/admin`) — like Payload's or Strapi's admin panels, the consuming app never touches the UI framework itself, so this choice is purely an internal build decision, not a compatibility constraint.

**React**, for the ecosystem: TanStack Table + TanStack Query + react-hook-form + zod + shadcn/ui cover most of what a CRUD-heavy admin panel needs (dynamic forms/tables driven by the field-system schema, filter builders for the permissions scope DSL) with mature, composable pieces. Bundle size — Svelte's usual edge — matters less here since this is an internal tool for CMS staff, not a public-facing app.

## Suggested package layout

```
oxygen/
  packages/
    core/         # Hono app factory, CRUD generator, config plumbing
    fields/       # independent field/type system + Drizzle translation layer
    auth/         # auth strategy interface, OTP implementation, cookie + JWT session handling
    permissions/  # roles/permissions tables, scope-filter + field allow-list enforcement
    email/        # email adapter interface + Resend/Postmark/SES adapters
    storage/      # storage interface + S3 + local adapters
    client/       # typed REST client
    admin/        # React admin UI, built to static assets, served via serveStatic
  docs/
```

Monorepo (pnpm workspaces) even at this size, since these are genuinely separable install targets (a consumer might want core+auth but bring their own storage).

## Phased build order

1. **Scaffolding** — pnpm workspace, TypeScript config, tsup for builds, vitest for tests, Drizzle wired up against Turso in a throwaway example app (validates the driver-agnostic boundary from day one instead of assuming it works later).
2. **Field system + Drizzle translation** — `defineCollection`/`defineSingle` + field builders (text, relation, group, array, conditional, upload, etc.), independent of Drizzle; a translation layer that lowers field defs to Drizzle columns + drizzle-kit migrations. Singles reuse this wholesale — just a fixed single-row table instead of arbitrary rows.
3. **Hono app factory + CRUD generator** — `oxygen({ db, collections, singles })` returns a mountable Hono instance with generated list/get/create/update/delete routes per collection, and GET/PATCH-only routes per single. Design rule: no module-level singletons/caches, everything scoped to the returned instance, so nothing blocks calling `oxygen()` more than once per process later (e.g. per-tenant) even though multi-tenancy isn't a built feature yet.
4. **Email adapter interface + Resend adapter** — the interface other providers (Postmark, SES) will implement later; used by OTP delivery.
5. **CMS user auth (OTP, cookie sessions)** — users collection, OTP request/verify endpoints, signed httpOnly cookie session issuance, auth middleware protecting CMS routes.
6. **App user auth (OTP, JWT sessions)** — same OTP primitive, second auth domain, access + refresh JWT pair for app-user-facing routes.
7. **Permissions** — roles/user_roles/permissions tables; scope-filter enforcement spliced into the CRUD generator's query path, field allow-list enforcement on read/write; deny-by-default with a super-admin bypass. Depends on the filter DSL from the CRUD generator (phase 3) and both auth domains (phases 5–6) existing first.
8. **Typed query client** — REST client generated from/aligned to collection definitions.
9. **Webhooks** — hook registration on collections, dispatch + signing + retry.
10. **S3 storage adapter** — upload fields, presigned URLs, local-disk dev adapter.
11. **Custom route ergonomics + docs** — helpers for accessing db/auth context from routes mounted alongside oxygen; write the actual install/integration docs.
12. **(Stretch) Admin UI** — React admin panel over the REST API (TanStack Table/Query, react-hook-form, shadcn/ui), built to static assets and served via Hono once the above is stable.

## Resolved decisions

- **Email provider**: adapter pattern, ship Resend first, Postmark/SES adapters follow.
- **Sessions**: cookies for CMS users, JWT (access + refresh) for app users.
- **Field system**: full independent type system (not a thin Drizzle wrapper) — conditional fields, groups/arrays, relation/upload — with a translation layer down to Drizzle.
- **Multi-tenancy**: no dedicated feature in v1; design rule is no global mutable state so nothing blocks it later.
- **Database driver**: driver-agnostic via Drizzle's SQLite dialect (oxygen depends on none specifically); Turso recommended as the default for docs/example app. Edge/serverless runtime support is undecided, so this stays a recommendation, not a hard requirement, for now.
- **Singles**: first-class primitive alongside collections (`defineSingle`), named "Singles" — same field system, narrower GET/PATCH-only REST surface, one row seeded at migration time.
- **Permissions**: DB-backed roles/permissions tables (not Payload-style access-control functions), covering both CMS and app users. Row-level scope reuses the query-layer filter DSL; field-level is a plain allow-list. Deny by default, super-admin bypass. Scope and field columns included from the first schema pass rather than bolted on later.
- **Admin UI framework**: React (TanStack Table/Query, react-hook-form, shadcn/ui), built to static assets and served via Hono `serveStatic` — an internal build choice, not a constraint on the consuming app's stack.
