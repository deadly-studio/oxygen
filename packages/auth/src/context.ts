import type { Context } from 'hono'
import { verifyAccessToken } from './app-tokens.js'
import type { AppTokenPayload } from './app-tokens.js'

const BEARER_PREFIX = 'Bearer '

/**
 * Pulls the raw token out of `Authorization: Bearer <token>`, or `undefined`
 * if the header is absent or uses a different scheme. Shared by
 * `getAppUser` here and `@deadly-studio/oxygen-permissions`' principal
 * resolution, so the parsing rule lives in exactly one place.
 */
export function getBearerToken(c: Context): string | undefined {
  const header = c.req.header('authorization')
  return header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined
}

/**
 * Identifies the app user making this request from its bearer access token
 * — for a consumer's own routes mounted alongside `oxygen()`
 * (docs/BUILD_PLAN.md#4-the-hono-mount-point), which don't go through the
 * CRUD generator's permission enforcement and so have no other way to know
 * who's calling. Returns just the verified token payload (`{ sub, slug }`),
 * not the hydrated row — the consumer already has `db` and their own
 * collection's table in scope to look that up themselves, and this helper
 * doesn't need to know a resolved schema to do its job.
 */
export async function getAppUser(c: Context, jwtSecret: string): Promise<AppTokenPayload | undefined> {
  const token = getBearerToken(c)
  if (!token) return undefined
  return verifyAccessToken(jwtSecret, token)
}
