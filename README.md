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
permissions enforcement, webhooks, S3/local storage, a typed client, and an MVP React admin UI are built
and tested — all 12 phases in `docs/BUILD_PLAN.md` have at least a working version now. Notable gaps: no
REST admin surface for roles/permissions yet, no `oxygen generate` migration CLI yet, and the admin UI is
an MVP rather than full parity with its `docs/BUILD_PLAN.md` design — see `docs/GUIDE.md`'s "Known gaps"
for specifics.
