import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { errorResponse, ulid } from '@deadly-studio/oxygen'
import type { AppAuthStrategy, OxygenDatabase, ResolvedResource } from '@deadly-studio/oxygen'
import type { EmailAdapter } from '@deadly-studio/oxygen-email'
import { issueTokenPair, revokeRefreshToken, rotateRefreshToken } from './app-tokens.js'
import { isNonEmptyString, isValidEmail, readJsonBody } from './http.js'
import { issueOtpCode, verifyOtpCode } from './otp.js'
import type { OtpVerifyResult } from './otp.js'

export interface AppOtpAuthOptions {
  /** Delivers the OTP code — see docs/SPEC.md#app-user-auth-otp--jwt. */
  email: EmailAdapter
  /** Signs access tokens (HS256 via `hono/utils/jwt`); use a long random secret unique to this deployment. */
  jwtSecret: string
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
 * Finds the app-user row identified by `email` in this collection's own
 * table, creating one on first sign-in (self-service signup — there's no
 * separate registration endpoint, see docs/SPEC.md#app-user-auth-otp--jwt).
 * Only `email` is set; any other required field on the collection needs a
 * `.default()` or a later authenticated PATCH to fill in, since OTP verify
 * can't ask the caller for arbitrary collection-specific data.
 */
async function findOrCreateAppUser(
  db: OxygenDatabase,
  resource: ResolvedResource,
  email: string,
): Promise<Record<string, unknown>> {
  const emailColumn = resource.columns.email!
  const existing = await db.select().from(resource.table).where(eq(emailColumn, email)).get()
  if (existing) return existing as Record<string, unknown>

  const now = new Date()
  const [created] = (await db
    .insert(resource.table)
    .values({ id: ulid(), email, createdAt: now, updatedAt: now })
    .returning()
    .all()) as Record<string, unknown>[]
  return created!
}

function createAppAuthRouter(db: OxygenDatabase, resource: ResolvedResource, options: AppOtpAuthOptions): Hono {
  const purpose = `app:${resource.slug}`
  const app = new Hono()

  app.post('/otp/request', async (c) => {
    const body = await readJsonBody(c)
    if (!body || !isValidEmail(body.identifier)) {
      return errorResponse(c, 400, [{ field: 'identifier', message: 'A valid email is required.' }])
    }
    const identifier = body.identifier.toLowerCase()

    // Self-service: unlike CMS auth, any email can sign up, so there's no
    // enumeration concern here — always send.
    const code = await issueOtpCode(db, identifier, purpose)
    await options.email.send({
      to: identifier,
      subject: 'Your sign-in code',
      text: `Your code is ${code}. It expires in 10 minutes.`,
    })
    return c.json({ message: 'A code has been sent.' })
  })

  app.post('/otp/verify', async (c) => {
    const body = await readJsonBody(c)
    if (!body || !isValidEmail(body.identifier) || !isNonEmptyString(body.code)) {
      return errorResponse(c, 400, [{ message: 'A valid email and code are required.' }])
    }
    const identifier = body.identifier.toLowerCase()

    const result = await verifyOtpCode(db, identifier, purpose, body.code)
    if (result !== 'ok') return errorResponse(c, 401, [{ message: otpErrorMessage(result) }])

    const user = await findOrCreateAppUser(db, resource, identifier)
    const pair = await issueTokenPair(db, options.jwtSecret, { sub: user.id as string, slug: resource.slug })
    return c.json({ ...pair, user })
  })

  app.post('/refresh', async (c) => {
    const body = await readJsonBody(c)
    if (!body || !isNonEmptyString(body.refreshToken)) {
      return errorResponse(c, 400, [{ message: 'refreshToken is required.' }])
    }
    const result = await rotateRefreshToken(db, options.jwtSecret, resource.slug, body.refreshToken)
    if (!result.ok) return errorResponse(c, 401, [{ message: 'Invalid or expired refresh token.' }])
    return c.json(result.pair)
  })

  app.post('/logout', async (c) => {
    const body = await readJsonBody(c)
    if (!body || !isNonEmptyString(body.refreshToken)) {
      return errorResponse(c, 400, [{ message: 'refreshToken is required.' }])
    }
    await revokeRefreshToken(db, body.refreshToken)
    return c.json({ message: 'Logged out.' })
  })

  return app
}

/**
 * The OTP + JWT `AppAuthStrategy` — see docs/SPEC.md#app-user-auth-otp--jwt.
 * One call covers every auth-enabled collection; `oxygen()` invokes
 * `createRouter` once per such collection, passing its own resolved table.
 */
export function appOtpAuth(options: AppOtpAuthOptions): AppAuthStrategy {
  return {
    createRouter: (db, resource) => createAppAuthRouter(db, resource, options),
  }
}
