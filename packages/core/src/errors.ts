import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** See docs/SPEC.md#errors — `field` is omitted for non-field-scoped errors. */
export interface ApiError {
  field?: string
  message: string
}

export function errorResponse(c: Context, status: ContentfulStatusCode, errors: ApiError[]): Response {
  return c.json({ errors }, status)
}

export function notFound(c: Context, message = 'Not found.'): Response {
  return errorResponse(c, 404, [{ message }])
}

// Drizzle wraps the driver's error in its own DrizzleQueryError, whose own
// .message is the failed query/params, not the reason — the actual SQLite
// wording ("UNIQUE constraint failed: ...") lives a level or two down the
// .cause chain, and the exact depth varies per driver (better-sqlite3 vs
// libsql), so this walks the whole chain rather than assuming one.
function collectErrorMessages(error: unknown, depth = 0): string {
  if (!(error instanceof Error) || depth > 5) return ''
  const cause = (error as { cause?: unknown }).cause
  return `${error.message} ${collectErrorMessages(cause, depth + 1)}`
}

/** SQLite's own wording, shared by better-sqlite3/libsql/D1 — see docs/SPEC.md#errors. */
export function isUniqueConstraintError(error: unknown): boolean {
  return /UNIQUE constraint failed/i.test(collectErrorMessages(error))
}

export function isForeignKeyConstraintError(error: unknown): boolean {
  return /FOREIGN KEY constraint failed/i.test(collectErrorMessages(error))
}
