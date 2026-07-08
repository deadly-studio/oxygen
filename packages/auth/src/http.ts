import type { Context } from 'hono'

/** Shared by both auth domains' routers — see docs/SPEC.md#errors for the request-body conventions they follow. */
export async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json()
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_PATTERN.test(value)
}
