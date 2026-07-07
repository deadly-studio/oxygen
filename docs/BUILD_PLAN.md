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

### 6. Query layer

Every collection gets generated REST endpoints (list/get/create/update/delete) with filtering, sorting, and pagination via query params. A thin typed client wraps these endpoints so consuming apps get autocomplete against their own collection definitions instead of hand-rolled fetch calls.

### 7. Webhooks

Collection-level lifecycle hooks (`afterChange`, `afterDelete`, etc.) can dispatch signed HTTP webhooks (HMAC signature header) to configured endpoints, with retry/backoff.

### 8. Storage

Pluggable storage interface; S3 (or S3-compatible, e.g. R2) adapter first, local-disk adapter for dev. Upload fields on a collection get presigned-URL upload flow + metadata stored in SQLite.

## Suggested package layout

```
oxygen/
  packages/
    core/         # Hono app factory, CRUD generator, config plumbing
    fields/       # independent field/type system + Drizzle translation layer
    auth/         # auth strategy interface, OTP implementation, cookie + JWT session handling
    email/        # email adapter interface + Resend/Postmark/SES adapters
    storage/      # storage interface + S3 + local adapters
    client/       # typed REST client
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
7. **Typed query client** — REST client generated from/aligned to collection definitions.
8. **Webhooks** — hook registration on collections, dispatch + signing + retry.
9. **S3 storage adapter** — upload fields, presigned URLs, local-disk dev adapter.
10. **Custom route ergonomics + docs** — helpers for accessing db/auth context from routes mounted alongside oxygen; write the actual install/integration docs.
11. **(Stretch) Admin UI** — thin panel over the REST API once the above is stable.

## Resolved decisions

- **Email provider**: adapter pattern, ship Resend first, Postmark/SES adapters follow.
- **Sessions**: cookies for CMS users, JWT (access + refresh) for app users.
- **Field system**: full independent type system (not a thin Drizzle wrapper) — conditional fields, groups/arrays, relation/upload — with a translation layer down to Drizzle.
- **Multi-tenancy**: no dedicated feature in v1; design rule is no global mutable state so nothing blocks it later.
- **Database driver**: driver-agnostic via Drizzle's SQLite dialect (oxygen depends on none specifically); Turso recommended as the default for docs/example app. Edge/serverless runtime support is undecided, so this stays a recommendation, not a hard requirement, for now.
- **Singles**: first-class primitive alongside collections (`defineSingle`), named "Singles" — same field system, narrower GET/PATCH-only REST surface, one row seeded at migration time.
