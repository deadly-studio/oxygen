import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { ulid } from '@deadly-studio/oxygen'
import type { OxygenDatabase } from '@deadly-studio/oxygen'
import { cmsSessions, cmsUsers } from './tables.js'

const COOKIE_NAME = 'oxygen_cms_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface CmsUser {
  id: string
  email: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Issues a session row and sets the signed httpOnly cookie carrying its id
 * — see docs/SPEC.md#cms-user-auth-otp--cookie-sessions. The cookie only
 * ever holds an opaque session id, never user data, so revocation
 * (`destroySession`) is just deleting the row per
 * docs/BUILD_PLAN.md#5-two-auth-domains.
 */
export async function createSession(c: Context, db: OxygenDatabase, cookieSecret: string, userId: string): Promise<void> {
  const now = new Date()
  const sessionId = ulid()
  await db.insert(cmsSessions).values({
    id: sessionId,
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  })
  await setSignedCookie(c, COOKIE_NAME, sessionId, cookieSecret, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

/**
 * Resolves the requesting CMS user from the signed session cookie, or
 * `undefined` if the cookie is absent, its signature doesn't match, or the
 * session has expired. Shared by the auth middleware and `/auth/me` since
 * `/auth/*` isn't itself mounted behind that middleware — see
 * docs/BUILD_PLAN.md#4-the-hono-mount-point.
 */
export async function resolveSessionUser(c: Context, db: OxygenDatabase, cookieSecret: string): Promise<CmsUser | undefined> {
  const sessionId = await getSignedCookie(c, cookieSecret, COOKIE_NAME)
  if (!sessionId) return undefined

  const session = await db.select().from(cmsSessions).where(eq(cmsSessions.id, sessionId)).get()
  if (!session || session.expiresAt.getTime() < Date.now()) return undefined

  return (await db.select().from(cmsUsers).where(eq(cmsUsers.id, session.userId)).get()) as CmsUser | undefined
}

export async function destroySession(c: Context, db: OxygenDatabase, cookieSecret: string): Promise<void> {
  const sessionId = await getSignedCookie(c, cookieSecret, COOKIE_NAME)
  if (sessionId) await db.delete(cmsSessions).where(eq(cmsSessions.id, sessionId))
  deleteCookie(c, COOKIE_NAME, { path: '/' })
}
