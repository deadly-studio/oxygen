// Phase 3 — Hono app factory + CRUD generator + config plumbing — see docs/BUILD_PLAN.md
export { oxygen } from './oxygen.js'
export type { OxygenConfig } from './oxygen.js'
export type { CmsAuthStrategy } from './auth.js'
export type { OxygenDatabase } from './database.js'
export { ValidationFailure } from './crud.js'
export { QueryError } from './where.js'
export { ulid } from './ulid.js'
// Reused by auth-strategy implementations (e.g. @deadly-studio/oxygen-auth) so error
// responses share the exact envelope shape — see docs/SPEC.md#errors.
export { errorResponse, notFound } from './errors.js'
