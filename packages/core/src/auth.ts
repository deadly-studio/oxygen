import type { Hono, MiddlewareHandler } from 'hono'
import type { OxygenDatabase } from './database.js'

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
