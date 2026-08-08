# oxygen

A code-first, embeddable CMS for [Hono](https://hono.dev) apps — SQLite + [Drizzle ORM](https://orm.drizzle.team) for storage, schema defined in TypeScript (Payload-style), REST query layer, OTP auth for both CMS users and app users, webhooks, and S3-backed file storage.

Designed to drop into an existing Hono project rather than run as a standalone server.

See [`docs/GUIDE.md`](./docs/GUIDE.md) for a getting-started walkthrough (install → define collections →
mount → auth/permissions/storage/webhooks → custom routes), [`docs/BUILD_PLAN.md`](./docs/BUILD_PLAN.md)
for the architecture and build phases, and [`docs/SPEC.md`](./docs/SPEC.md) for the concrete v1 API surface
(routes, field types, request/response shapes). [`examples/basic`](./examples/basic) is the guide as a
runnable app.

## Status

Pre-alpha, nothing published yet, but functional: field system, CRUD generator, both auth domains,
permissions enforcement, webhooks, S3/local storage, and a typed client are built and tested (10 of the 12
phases in `docs/BUILD_PLAN.md`). Notable gaps: no REST admin surface for roles/permissions yet, no
`oxygen generate` migration CLI yet (see `docs/GUIDE.md`'s "Known gaps"), and no admin UI (phase 12,
stretch).
