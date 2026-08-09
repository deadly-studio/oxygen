# examples/basic

A real, runnable oxygen app — the companion to [`docs/GUIDE.md`](../../docs/GUIDE.md). Two collections
(`posts`, and `customers` with `auth: true`), a single (`site-settings`), CMS OTP+cookie auth, app-user
OTP+JWT auth, local-disk file storage, and one custom route showing the auth context helpers.

Backed by Drizzle's SQLite dialect over `@libsql/client`, defaulting to a local file (`./local.db`) with
zero setup, and switching to Turso unmodified once `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` are set —
validates that oxygen's storage layer really is driver-agnostic (docs/BUILD_PLAN.md#3-database-driver).

OTP codes are logged to stdout instead of emailed (see `src/email.ts`) — there's nothing to configure to
try the auth flow locally.

```bash
pnpm --filter oxygen-example-basic dev
```

```bash
# Claim the first CMS user (any email works while cms_users is empty — see
# docs/SPEC.md#bootstrapping-the-first-cms-user). The code is printed in the
# terminal running `pnpm dev`.
curl -X POST http://localhost:3000/cms/auth/otp/request \
  -H 'content-type: application/json' -d '{"email":"you@example.com"}'

curl -X POST http://localhost:3000/cms/auth/otp/verify \
  -H 'content-type: application/json' -d '{"email":"you@example.com","code":"123456"}' \
  -c cookies.txt

# Now authenticated as CMS staff:
curl -b cookies.txt -X POST http://localhost:3000/cms/collections/posts \
  -H 'content-type: application/json' -d '{"title":"Hello"}'
curl -b cookies.txt http://localhost:3000/cms/collections/posts

curl -b cookies.txt http://localhost:3000/api/whoami
```

App-user (customer) self-service signup works the same way against `/cms/app/customers/auth/otp/{request,verify}`,
returning a bearer token instead of a cookie — see [`docs/GUIDE.md`](../../docs/GUIDE.md#app-user-auth-otp--jwt).

Permission enforcement (`rolePermissions()`) is left commented out in `src/app.ts` so this example stays
usable without seeding role/permission rows first — see [`docs/GUIDE.md`](../../docs/GUIDE.md#permissions)
for how to turn it on.

Copy `.env.example` to `.env` and fill in Turso credentials to run the same code against a real Turso
database instead of the local file; set `CMS_COOKIE_SECRET`/`APP_JWT_SECRET` to anything beyond your own
machine (they default to fixed, clearly-insecure dev values otherwise).

`pnpm db:push` diffs `src/db/schema.ts` against the live database and applies — see
[`docs/GUIDE.md`](../../docs/GUIDE.md#migrations). `pnpm dev` already does this on startup.
