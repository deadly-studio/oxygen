# oxygen v1 — technical specification

This nails down the concrete API surface implied by [`BUILD_PLAN.md`](./BUILD_PLAN.md): field types,
generated routes, request/response shapes, the filter DSL, and how each concept lowers to SQLite. Where
the build plan left something as prose ("supports filtering, sorting, pagination") this spec picks the
actual shape. Treat it as the contract implementation should match, not aspirational design.

## v1 scope

Everything in the build plan's phased order (1–11): field system, CRUD generator, both auth domains,
permissions, email adapters, typed client, webhooks, S3 storage. Restating the non-goals from
`BUILD_PLAN.md` since they bound this doc too:

- No admin UI (phase 12, stretch, separate spec when it starts).
- No multi-database support — SQLite via Drizzle only.
- No GraphQL.

Two v1-only simplifications not yet called out in the build plan, both flagged inline below where they
apply: **array fields** and **hasMany relations** are stored as JSON columns, not child tables — no
`WHERE` filtering into array contents or SQL joins across relations in v1. Revisit once a real consumer
needs to query inside them.

## Collections & Singles

### `defineCollection`

```ts
const Posts = defineCollection({
  slug: 'posts',
  auth: false,
  fields: { /* ... */ },
  hooks: { /* ... */ },
})
```

- `slug` — table name and REST path segment. `[a-z][a-z0-9-]*`, unique across collections and singles.
- `auth` — `false` (default) for ordinary content. `true` marks this collection as an **app-user**
  collection: it gets an `passwordHash`-free OTP identity flow and JWT session issuance scoped to its
  own slug (see [App user auth](#app-user-auth-otp--jwt)). Multiple auth-enabled collections can coexist
  (e.g. `customers` and `vendors`), each with its own login namespace — nothing says "the" users
  collection, any collection can opt in.
- `hooks` — see [Hook lifecycle](#hook-lifecycle).

CMS staff users are **not** a `defineCollection` — they're a fixed, framework-owned table
(`cms_users`) described under [CMS user auth](#cms-user-auth-otp--cookie-sessions). Consumers don't
define CMS user shape in v1; it's small and fixed (email, roles, timestamps).

### `defineSingle`

```ts
const SiteSettings = defineSingle({
  slug: 'site-settings',
  fields: { /* ... */ },
  hooks: { /* ... */ },
})
```

Same field system and hook lifecycle as collections, minus `auth` (singles are never auth-enabled).
Backed by a table with exactly one row, seeded at migration time (`INSERT ... ON CONFLICT DO NOTHING`
against a fixed `id = 1`), never created or deleted through the API.

### Field catalog

Every field builder supports a common chainable base: `.required()`, `.unique()`, `.default(value)`,
`.index()`, `.condition((siblingData, fullDoc) => boolean)`. `condition` is validation-only in v1 (no
admin UI to hide/show yet) — a field whose condition evaluates false is treated as absent: not required
even if `.required()` is set, and rejected if a value is submitted anyway.

| Builder | SQLite column | Notes |
|---|---|---|
| `text()` | `TEXT` | `.minLength()`, `.maxLength()` |
| `textarea()` | `TEXT` | Alias of `text()`; no schema difference, just an admin-UI hint later |
| `richText()` | `TEXT` | Stores an opaque JSON string. No structure enforced in v1 — the eventual admin UI editor owns the shape; the API treats it as pass-through JSON |
| `number()` | `INTEGER` or `REAL` | `.int()` forces `INTEGER`; default is `REAL`. `.min()`, `.max()` |
| `boolean()` | `INTEGER` (0/1) | |
| `select(options)` | `TEXT` | `options: string[] \| { value, label }[]`. `.hasMany()` switches storage to a JSON array column |
| `date()` / `timestamp()` | `INTEGER` (unix ms, Drizzle `{ mode: 'timestamp' }`) | `.default('now')` |
| `relation(slug)` | `INTEGER` (FK id) | `.hasMany()` switches to a JSON array-of-ids column — **v1 simplification**: hasMany relations aren't joinable in SQL, just fetched and hydrated app-side |
| `upload(slug?)` | flattened group: `key`, `filename`, `mimeType`, `filesize` (all `TEXT`/`INTEGER`) | `.accept(mimeTypes[])`. `slug` names which storage adapter/bucket config to use if more than one is configured |
| `group(fields)` | flattened, prefixed columns (`heading` under `group('hero', ...)` → column `hero_heading`) | No wrapper table — just a namespacing convenience over flat columns |
| `array(fields)` | `TEXT` (JSON) | **v1 simplification**: serialized JSON array of objects matching the nested field shape, not a child table. `.minRows()`, `.maxRows()` |
| `json()` | `TEXT` | Escape hatch — arbitrary JSON, validated only as "is valid JSON" |

### Hook lifecycle

Registered per-collection/single as arrays of functions, run in registration order:

```
beforeValidate → beforeChange → (write) → afterChange
beforeDelete → (delete) → afterDelete
afterRead
```

`beforeChange`/`beforeValidate` receive `(data, { operation: 'create' | 'update', previousDoc? })` and
may return a modified `data`. `afterChange`/`afterDelete`/`afterRead` are fire-and-forget (webhooks hang
off `afterChange`/`afterDelete`; return values ignored).

## Generated REST API

Mounted wherever the consumer routes the returned Hono instance (`app.route('/cms', cms)` in the build
plan's example — routes below are relative to that mount point).

### Collections

| Method | Path | |
|---|---|---|
| GET | `/collections/:slug` | list |
| GET | `/collections/:slug/:id` | get one |
| POST | `/collections/:slug` | create |
| PATCH | `/collections/:slug/:id` | update |
| DELETE | `/collections/:slug/:id` | delete |
| POST | `/collections/:slug/upload-url` | presigned upload URL, only present if the collection has an `upload()` field — see [Storage](#storage) |

### Singles

| Method | Path | |
|---|---|---|
| GET | `/singles/:slug` | |
| PATCH | `/singles/:slug` | |

No list, no id routes, no create/delete — enforced at the router level, not just by convention.

### Query DSL (list endpoint)

- `?where=<json>` — filter object, URL-encoded JSON. Shorthand `{ field: value }` means equality;
  richer queries use operator objects:

  ```
  { field: { $eq | $ne | $gt | $gte | $lt | $lte | $in | $nin | $like | $exists: value } }
  ```

  Combinators: `{ $and: [...] }`, `{ $or: [...] }`, nestable. This is the exact same grammar
  `cms_permissions.scope` uses (see [Permissions](#permissions)) — one filter language for both
  user-supplied `?where=` and role-based scoping, ANDed together at query time.
- `?sort=field` ascending, `?sort=-field` descending, comma-separated for multiple:
  `?sort=-publishedAt,title`.
- `?limit=` (default 10, max 100) and `?page=` (default 1) — offset pagination, not cursor, for v1.

### Response envelopes

List:

```jsonc
{
  "docs": [ /* ... */ ],
  "totalDocs": 42,
  "limit": 10,
  "page": 2,
  "totalPages": 5,
  "hasPrevPage": true,
  "hasNextPage": true,
  "prevPage": 1,
  "nextPage": 3
}
```

Get one / single GET: the raw document, unwrapped.

Create / update / single PATCH:

```jsonc
{ "message": "Post created.", "doc": { /* ... */ } }
```

Delete:

```jsonc
{ "message": "Post deleted." }
```

### Errors

```jsonc
{ "errors": [{ "field": "title", "message": "title is required." }] }
```

`field` omitted for non-field-scoped errors (auth failures, not-found, etc.). Status codes: `400`
validation, `401` unauthenticated, `403` forbidden (permission denied), `404` not found, `409` conflict
(e.g. unique constraint), `500` unhandled.

## Auth

### CMS user auth (OTP + cookie sessions)

Fixed, framework-owned table `cms_users` (`id`, `email`, `createdAt`, `updatedAt`), joined to roles via
`cms_user_roles`. Not namespaced by slug — there's exactly one CMS user identity.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/otp/request` | `{ email }` | `{ message }` |
| POST | `/auth/otp/verify` | `{ email, code }` | Sets signed httpOnly session cookie; `{ user }` |
| POST | `/auth/logout` | — | Clears cookie; `{ message }` |
| GET | `/auth/me` | — | `{ user }` or `401` |

### App user auth (OTP + JWT)

Namespaced per auth-enabled collection slug, since a consumer may have more than one
(`customers`, `vendors`, ...):

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/app/:slug/auth/otp/request` | `{ identifier }` | `{ message }` |
| POST | `/app/:slug/auth/otp/verify` | `{ identifier, code }` | `{ accessToken, refreshToken, user }` |
| POST | `/app/:slug/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` (rotated) |
| POST | `/app/:slug/auth/logout` | `{ refreshToken }` | Revokes; `{ message }` |

`identifier` is email for v1 (SMS/phone deferred per build plan's "email first, SMS later"). OTP codes
live in a shared `cms_otp_codes` table (`id`, `identifier`, `codeHash`, `purpose` [`cms` | `app:<slug>`],
`expiresAt`, `consumedAt`, `attempts`) regardless of domain — same primitive, different `purpose` tag.

## Permissions

Tables as specified in `BUILD_PLAN.md`:

```
cms_roles           (id, name)
cms_user_roles      (userId, roleId)
cms_permissions     (id, roleId, resource, action, scope, fields)
```

Enforcement, per request:

1. Resolve the current principal's roles (CMS session or app-user JWT both carry a role set — app users
   get an implicit default role, e.g. `self`, if none assigned).
2. Super-admin role bypasses everything below entirely.
3. Gather all `cms_permissions` rows matching `(resource = <collection/single slug>, action)`. No rows
   → `403`.
4. **Scope**: OR each matching row's `scope` together (a user holding multiple roles gets the union of
   what those roles allow), then AND the result into the query's `where` — same filter DSL as
   `?where=`, so `$currentUser` resolves to the requesting principal's id at query time.
5. **Fields**: union the `fields` allow-lists across matching rows; any matching row with `fields: null`
   grants all fields. Read: strip disallowed fields from the response. Write: reject a payload touching
   a disallowed field with a `403` field error rather than silently dropping it.

## Webhooks

Registered as a hook helper, not a separately managed REST resource in v1:

```ts
hooks: {
  afterChange: [webhook({ url: 'https://...', secret: process.env.WEBHOOK_SECRET })],
}
```

Delivery body:

```jsonc
{ "event": "afterChange", "collection": "posts", "doc": { /* ... */ }, "previousDoc": { /* ... */ } }
```

Signed via `X-Oxygen-Signature: sha256=<hmac of raw body with secret>`. Failed deliveries persist to
`cms_webhook_deliveries` (`id`, `event`, `url`, `payload`, `status`, `attempts`, `nextAttemptAt`,
`lastError`) and retry on a fixed backoff schedule: 1m, 5m, 15m, 1h, 6h, then give up.

## Storage

```ts
interface StorageAdapter {
  getUploadUrl(key: string, contentType: string): Promise<{ url: string; fields?: Record<string, string> }>
  getDownloadUrl(key: string): Promise<string>
  delete(key: string): Promise<void>
}
```

Upload field flow:

1. `POST /collections/:slug/upload-url` with `{ filename, contentType }` → `{ uploadUrl, key }`.
2. Client PUTs/POSTs the file directly to `uploadUrl` (S3 presigned), bypassing oxygen entirely.
3. Client creates/updates the doc, setting the upload field to `{ key, filename, mimeType, filesize }` —
   oxygen doesn't re-verify the upload happened in v1, it trusts the metadata the client reports.

## Typed client

```ts
const client = createClient<{ posts: typeof Posts; 'site-settings': typeof SiteSettings }>({ baseUrl })

client.collection('posts').find({ where, sort, limit, page })
client.collection('posts').findById(id)
client.collection('posts').create(data)
client.collection('posts').update(id, data)
client.collection('posts').delete(id)

client.single('site-settings').get()
client.single('site-settings').update(data)

client.auth.cms.otp.request(email)
client.auth.cms.otp.verify(email, code)
client.auth.app('customers').otp.request(identifier)
client.auth.app('customers').otp.verify(identifier, code)
client.auth.app('customers').refresh(refreshToken)
```

Types for `find`/`create`/`update` payloads are inferred from the collection's field definitions, not
hand-maintained.

## Email adapters

```ts
interface EmailAdapter {
  send(message: { to: string; subject: string; text?: string; html?: string }): Promise<void>
}
```

Ship `resendAdapter()` first; `postmarkAdapter()` and `sesAdapter()` follow once the interface has a
second real consumer to stabilize against. OTP delivery is the only v1 caller.
