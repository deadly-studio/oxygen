import { eq } from 'drizzle-orm'
import { Jwt } from 'hono/utils/jwt'
import { ulid } from '@deadly-studio/oxygen'
import type { OxygenDatabase } from '@deadly-studio/oxygen'
import { appRefreshTokens } from './tables.js'

const JWT_ALG = 'HS256'
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** `sub` is the row id in the auth-enabled collection's own table; `slug` disambiguates its login namespace — see docs/SPEC.md#app-user-auth-otp--jwt. */
export interface AppTokenPayload {
  sub: string
  slug: string
}

export interface AppTokenPair {
  accessToken: string
  refreshToken: string
}

async function signAccessToken(jwtSecret: string, payload: AppTokenPayload): Promise<string> {
  const exp = Math.floor((Date.now() + ACCESS_TOKEN_TTL_MS) / 1000)
  return Jwt.sign({ ...payload, exp }, jwtSecret, JWT_ALG)
}

/**
 * Verifies a bearer access token minted for `slug`. This is the only public
 * surface for "who is this app user" until docs/BUILD_PLAN.md#11-custom-route-ergonomics-docs
 * lands helpers for a consumer's own routes mounted alongside `oxygen()` —
 * until then, call this directly.
 */
export async function verifyAccessToken(jwtSecret: string, slug: string, token: string): Promise<AppTokenPayload | undefined> {
  try {
    const payload = await Jwt.verify(token, jwtSecret, JWT_ALG)
    if (typeof payload.sub !== 'string' || payload.slug !== slug) return undefined
    return { sub: payload.sub, slug: payload.slug }
  } catch {
    return undefined
  }
}

/** Issues a fresh access+refresh pair, persisting the refresh token (its id doubles as the bearer value, see tables.ts) so it can later be rotated/revoked. */
export async function issueTokenPair(db: OxygenDatabase, jwtSecret: string, payload: AppTokenPayload): Promise<AppTokenPair> {
  const accessToken = await signAccessToken(jwtSecret, payload)
  const now = new Date()
  const refreshToken = ulid()
  await db.insert(appRefreshTokens).values({
    id: refreshToken,
    collectionSlug: payload.slug,
    userId: payload.sub,
    createdAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
  })
  return { accessToken, refreshToken }
}

export type RefreshResult = { ok: true; pair: AppTokenPair } | { ok: false }

/** Rotates a live refresh token for `slug`: revokes it and issues a brand new pair — see docs/SPEC.md#app-user-auth-otp--jwt. */
export async function rotateRefreshToken(
  db: OxygenDatabase,
  jwtSecret: string,
  slug: string,
  refreshToken: string,
): Promise<RefreshResult> {
  const row = await db.select().from(appRefreshTokens).where(eq(appRefreshTokens.id, refreshToken)).get()
  if (!row || row.collectionSlug !== slug || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
    return { ok: false }
  }
  await db.update(appRefreshTokens).set({ revokedAt: new Date() }).where(eq(appRefreshTokens.id, refreshToken))
  const pair = await issueTokenPair(db, jwtSecret, { sub: row.userId, slug: row.collectionSlug })
  return { ok: true, pair }
}

/** Idempotent — logging out with an already-revoked or unknown refresh token is not an error, it just affects zero rows. */
export async function revokeRefreshToken(db: OxygenDatabase, refreshToken: string): Promise<void> {
  await db.update(appRefreshTokens).set({ revokedAt: new Date() }).where(eq(appRefreshTokens.id, refreshToken))
}
