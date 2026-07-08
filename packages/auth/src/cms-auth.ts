import { eq, sql } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { errorResponse, ulid } from '@deadly-studio/oxygen'
import type { CmsAuthStrategy, OxygenDatabase } from '@deadly-studio/oxygen'
import type { EmailAdapter } from '@deadly-studio/oxygen-email'
import { issueOtpCode, verifyOtpCode } from './otp.js'
import type { OtpVerifyResult } from './otp.js'
import { createSession, destroySession, resolveSessionUser } from './session.js'
import type { CmsUser } from './session.js'
import { cmsRoles, cmsUserRoles, cmsUsers, SUPER_ADMIN_ROLE } from './tables.js'

const OTP_PURPOSE = 'cms'
const BOOTSTRAP_TOKEN_HEADER = 'X-Oxygen-Bootstrap-Token'

/** Key `resolveSessionUser`'s result is stashed under on the request context — see docs/SPEC.md#permissions for the phase-7 consumer of this. */
export const CMS_USER_CONTEXT_KEY = 'cmsUser'

export interface OtpAuthOptions {
  /** Delivers the OTP code — see docs/BUILD_PLAN.md#5-cms-user-auth-otp-cookie-sessions. */
  email: EmailAdapter
  /** Signs the session cookie (HMAC via `hono/cookie`); use a long random secret unique to this deployment. */
  cookieSecret: string
  /**
   * Extra gate on `/auth/otp/verify` while `cms_users` is still empty — see
   * docs/SPEC.md#bootstrapping-the-first-cms-user. Unset (default) means
   * bootstrap proceeds on the empty-table check alone.
   */
  bootstrapToken?: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_PATTERN.test(value)
}

async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json()
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function cmsUserCount(db: OxygenDatabase): Promise<number> {
  const row = await db.select({ count: sql<number>`count(*)` }).from(cmsUsers).get()
  return row?.count ?? 0
}

function otpErrorMessage(result: Exclude<OtpVerifyResult, 'ok'>): string {
  switch (result) {
    case 'expired':
      return 'This code has expired — request a new one.'
    case 'locked':
      return 'Too many incorrect attempts — request a new code.'
    default:
      return 'Invalid code.'
  }
}

/**
 * Creates the bootstrap user + grants `SUPER_ADMIN_ROLE` in one transaction
 * (so two concurrent bootstrap verifies can't both succeed, per
 * docs/SPEC.md#bootstrapping-the-first-cms-user) — re-checking emptiness
 * inside the transaction in case another request's bootstrap already landed
 * between this request's earlier check and now.
 */
async function bootstrapUser(db: OxygenDatabase, email: string): Promise<CmsUser> {
  return db.transaction(async (tx) => {
    const countRow = await tx.select({ count: sql<number>`count(*)` }).from(cmsUsers).get()
    if ((countRow?.count ?? 0) > 0) {
      const existing = await tx.select().from(cmsUsers).where(eq(cmsUsers.email, email)).get()
      if (existing) return existing as CmsUser
    }

    const now = new Date()
    const [user] = (await tx
      .insert(cmsUsers)
      .values({ id: ulid(), email, createdAt: now, updatedAt: now })
      .returning()
      .all()) as CmsUser[]

    let role = await tx.select().from(cmsRoles).where(eq(cmsRoles.name, SUPER_ADMIN_ROLE)).get()
    if (!role) {
      ;[role] = await tx.insert(cmsRoles).values({ id: ulid(), name: SUPER_ADMIN_ROLE }).returning().all()
    }
    await tx.insert(cmsUserRoles).values({ userId: user!.id, roleId: role!.id })

    return user!
  })
}

function createCmsAuthRouter(db: OxygenDatabase, options: OtpAuthOptions): Hono {
  const app = new Hono()

  app.post('/otp/request', async (c) => {
    const body = await readJsonBody(c)
    if (!body || !isValidEmail(body.email)) {
      return errorResponse(c, 400, [{ field: 'email', message: 'A valid email is required.' }])
    }
    const email = body.email.toLowerCase()
    const bootstrapping = (await cmsUserCount(db)) === 0

    // Outside bootstrap, only send (and only reveal a code exists) for a
    // real cms_users row — otherwise this endpoint becomes an email
    // enumeration oracle. Same generic response either way.
    if (bootstrapping || (await db.select().from(cmsUsers).where(eq(cmsUsers.email, email)).get())) {
      const code = await issueOtpCode(db, email, OTP_PURPOSE)
      await options.email.send({
        to: email,
        subject: 'Your sign-in code',
        text: `Your code is ${code}. It expires in 10 minutes.`,
      })
    }
    return c.json({ message: 'If that email has access, a code has been sent.' })
  })

  app.post('/otp/verify', async (c) => {
    const body = await readJsonBody(c)
    if (!body || !isValidEmail(body.email) || !isNonEmptyString(body.code)) {
      return errorResponse(c, 400, [{ message: 'A valid email and code are required.' }])
    }
    const email = body.email.toLowerCase()
    const bootstrapping = (await cmsUserCount(db)) === 0

    if (bootstrapping && options.bootstrapToken && c.req.header(BOOTSTRAP_TOKEN_HEADER) !== options.bootstrapToken) {
      return errorResponse(c, 401, [{ message: 'Missing or invalid bootstrap token.' }])
    }

    const result = await verifyOtpCode(db, email, OTP_PURPOSE, body.code)
    if (result !== 'ok') return errorResponse(c, 401, [{ message: otpErrorMessage(result) }])

    const user = bootstrapping
      ? await bootstrapUser(db, email)
      : ((await db.select().from(cmsUsers).where(eq(cmsUsers.email, email)).get()) as CmsUser | undefined)
    if (!user) return errorResponse(c, 401, [{ message: 'No CMS user with this email.' }])

    await createSession(c, db, options.cookieSecret, user.id)
    return c.json({ user })
  })

  app.post('/logout', async (c) => {
    await destroySession(c, db, options.cookieSecret)
    return c.json({ message: 'Logged out.' })
  })

  app.get('/me', async (c) => {
    const user = await resolveSessionUser(c, db, options.cookieSecret)
    if (!user) return errorResponse(c, 401, [{ message: 'Not authenticated.' }])
    return c.json({ user })
  })

  return app
}

function createCmsAuthMiddleware(db: OxygenDatabase, options: OtpAuthOptions): MiddlewareHandler {
  return async (c, next) => {
    const user = await resolveSessionUser(c, db, options.cookieSecret)
    if (!user) return errorResponse(c, 401, [{ message: 'Not authenticated.' }])
    c.set(CMS_USER_CONTEXT_KEY, user)
    await next()
  }
}

/**
 * The OTP + cookie-session `CmsAuthStrategy` — see
 * docs/SPEC.md#cms-user-auth-otp--cookie-sessions. Structurally satisfies
 * `@deadly-studio/oxygen`'s `CmsAuthStrategy` interface without that package
 * depending on this one.
 */
export function otpAuth(options: OtpAuthOptions): CmsAuthStrategy {
  return {
    createRouter: (db) => createCmsAuthRouter(db, options),
    middleware: (db) => createCmsAuthMiddleware(db, options),
  }
}
