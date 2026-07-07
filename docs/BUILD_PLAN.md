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

### 2. The Hono mount point

```ts
import { Hono } from 'hono'
import { oxygen } from '@deadly-studio/oxygen'

const app = new Hono()
const cms = oxygen({
  db,                 // drizzle client
  collections: [Posts, Users],
  storage: s3Storage({ bucket, region }),
  auth: { cms: otpAuth(), app: otpAuth() },
})

app.route('/cms', cms)
app.route('/api/custom-thing', myOwnRouter) // untouched, just Hono
```

Because it's just a Hono instance under the hood, adding bespoke routes alongside the generated CRUD routes is "use Hono like you already do" — no plugin API to learn for that part.

### 3. Two auth domains

- **CMS users** — people editing content in the admin/API (internal staff). Session-based.
- **App users** — the consuming application's end users, who authenticate against the same CMS to read/write their own scoped data.

Both should support OTP (email first, SMS later) as the primary flow, since that's the priority auth method, with password as a fallback strategy behind the same interface. Auth is pluggable (strategy interface) so OTP isn't hardcoded in — but it's the one we build and dogfood first.

### 4. Query layer

Every collection gets generated REST endpoints (list/get/create/update/delete) with filtering, sorting, and pagination via query params. A thin typed client wraps these endpoints so consuming apps get autocomplete against their own collection definitions instead of hand-rolled fetch calls.

### 5. Webhooks

Collection-level lifecycle hooks (`afterChange`, `afterDelete`, etc.) can dispatch signed HTTP webhooks (HMAC signature header) to configured endpoints, with retry/backoff.

### 6. Storage

Pluggable storage interface; S3 (or S3-compatible, e.g. R2) adapter first, local-disk adapter for dev. Upload fields on a collection get presigned-URL upload flow + metadata stored in SQLite.

## Suggested package layout

```
oxygen/
  packages/
    core/         # collection config, schema generation, Hono app factory, CRUD generator
    auth/         # auth strategy interface + OTP implementation
    storage/      # storage interface + S3 + local adapters
    client/       # typed REST client
  docs/
```

Monorepo (pnpm workspaces) even at this size, since these are genuinely separable install targets (a consumer might want core+auth but bring their own storage).

## Phased build order

1. **Scaffolding** — pnpm workspace, TypeScript config, tsup for builds, vitest for tests, Drizzle + better-sqlite3 wired up in a throwaway example app.
2. **Collection config → Drizzle schema** — `defineCollection`, field types, schema generation, drizzle-kit migration flow.
3. **Hono app factory + CRUD generator** — `oxygen({ db, collections })` returns a mountable Hono instance with generated list/get/create/update/delete routes per collection.
4. **CMS user auth (OTP)** — users collection, OTP request/verify endpoints, session issuance, auth middleware protecting CMS routes.
5. **App user auth (OTP)** — same primitive, second auth domain, scoped tokens for app-user-facing routes.
6. **Typed query client** — REST client generated from/aligned to collection definitions.
7. **Webhooks** — hook registration on collections, dispatch + signing + retry.
8. **S3 storage adapter** — upload fields, presigned URLs, local-disk dev adapter.
9. **Custom route ergonomics + docs** — helpers for accessing db/auth context from routes mounted alongside oxygen; write the actual install/integration docs.
10. **(Stretch) Admin UI** — thin panel over the REST API once the above is stable.

## Open questions to resolve early

- OTP delivery: email provider now, SMS provider deferred — which email provider (Resend/Postmark/SES)?
- Session strategy: signed cookies vs. bearer JWT for CMS users vs. app users — may differ per domain.
- How much of the field/type system to build vs. lean on Drizzle's own column types directly.
- Multi-tenancy: is this ever mounted twice in one process (e.g. per-tenant DB), and does that constrain the config API now to avoid a breaking change later.
