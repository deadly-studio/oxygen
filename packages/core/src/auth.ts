import type { Hono, MiddlewareHandler } from 'hono'
import type { OxygenDatabase } from './database.js'
import type { ResolvedResource } from './schema.js'

/**
 * Shape a pluggable CMS auth strategy must satisfy — see
 * docs/BUILD_PLAN.md#5-two-auth-domains. Defined here (not in
 * `@deadly-studio/oxygen-auth`) so this package never depends on that one;
 * `otpAuth()` just returns an object matching this structurally.
 */
export interface CmsAuthStrategy {
  /** Routes mounted at `/auth` relative to the `oxygen()` mount point (`/auth/otp/request`, etc). */
  createRouter(db: OxygenDatabase): Hono
  /** Applied ahead of `/collections/*` and `/singles/*` — authentication only, not permission enforcement (phase 7). */
  middleware(db: OxygenDatabase): MiddlewareHandler
}

/**
 * Shape a pluggable app-user auth strategy must satisfy — see
 * docs/SPEC.md#app-user-auth-otp--jwt. Instantiated once per `auth: true`
 * collection (each gets its own login namespace, docs/BUILD_PLAN.md#5-two-auth-domains),
 * so `resource` gives the implementation the collection's own table/columns
 * to look identities up against — unlike CMS users, there's no fixed
 * framework-owned table here. No `middleware` yet: verifying the bearer JWT
 * against a collection's own CRUD routes is scope-dependent (phase 7's
 * `$currentUser`), and access from a consumer's own custom routes is
 * phase 11 — until then, `appOtpAuth()`'s token-verifying helper is called
 * directly.
 */
export interface AppAuthStrategy {
  /** Routes mounted at `/app/:slug/auth` for this collection (`/app/:slug/auth/otp/request`, etc). */
  createRouter(db: OxygenDatabase, resource: ResolvedResource): Hono
}
