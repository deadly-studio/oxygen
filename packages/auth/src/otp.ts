import { and, desc, eq, isNull } from 'drizzle-orm'
import { ulid } from '@deadly-studio/oxygen'
import type { OxygenDatabase } from '@deadly-studio/oxygen'
import { cmsOtpCodes } from './tables.js'

const CODE_LENGTH = 6
const CODE_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

// Uniform over Node/Workers/Bun (global WebCrypto) rather than `node:crypto`,
// consistent with oxygen having no runtime-specific dependency — see
// docs/BUILD_PLAN.md#3-database-driver.
function generateCode(): string {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return String(bytes[0]! % 10 ** CODE_LENGTH).padStart(CODE_LENGTH, '0')
}

async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Issues a fresh OTP for `identifier`/`purpose`, invalidating any still-live
 * code from an earlier request first (so only the most recently requested
 * code is ever valid). Returns the raw code — the only place it's visible in
 * plaintext, for the caller to hand to an `EmailAdapter`; only `codeHash`
 * persists. See docs/SPEC.md#cms-user-auth-otp--cookie-sessions.
 */
export async function issueOtpCode(db: OxygenDatabase, identifier: string, purpose: string): Promise<string> {
  await db
    .update(cmsOtpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(cmsOtpCodes.identifier, identifier), eq(cmsOtpCodes.purpose, purpose), isNull(cmsOtpCodes.consumedAt)))

  const code = generateCode()
  const now = new Date()
  await db.insert(cmsOtpCodes).values({
    id: ulid(),
    identifier,
    purpose,
    codeHash: await hashCode(code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    attempts: 0,
  })
  return code
}

export type OtpVerifyResult = 'ok' | 'invalid' | 'expired' | 'locked'

/**
 * Consumes the live code for `identifier`/`purpose` if `code` matches.
 * `locked` guards against brute force once `MAX_ATTEMPTS` wrong guesses have
 * been made against a single issued code — the caller must request a new one.
 */
export async function verifyOtpCode(
  db: OxygenDatabase,
  identifier: string,
  purpose: string,
  code: string,
): Promise<OtpVerifyResult> {
  const row = await db
    .select()
    .from(cmsOtpCodes)
    .where(and(eq(cmsOtpCodes.identifier, identifier), eq(cmsOtpCodes.purpose, purpose), isNull(cmsOtpCodes.consumedAt)))
    .orderBy(desc(cmsOtpCodes.expiresAt))
    .get()

  if (!row) return 'invalid'
  if (row.attempts >= MAX_ATTEMPTS) return 'locked'
  if (row.expiresAt.getTime() < Date.now()) return 'expired'

  const matches = (await hashCode(code)) === row.codeHash
  if (!matches) {
    await db
      .update(cmsOtpCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(cmsOtpCodes.id, row.id))
    return 'invalid'
  }

  await db.update(cmsOtpCodes).set({ consumedAt: new Date() }).where(eq(cmsOtpCodes.id, row.id))
  return 'ok'
}
