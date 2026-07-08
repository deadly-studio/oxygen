import { Hono } from 'hono'
import type { Context } from 'hono'
import { getDocument, updateDocument, ValidationFailure } from '../crud.js'
import type { OxygenDatabase } from '../database.js'
import { errorResponse, isForeignKeyConstraintError, isUniqueConstraintError, notFound } from '../errors.js'
import { pickAllowedFields, rejectDisallowedFields, requireGrant } from '../permissions.js'
import type { PermissionsStrategy } from '../permissions.js'
import type { ResolvedResource } from '../schema.js'

async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json()
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * GET/PATCH only — no list, no id routes, no create/delete, enforced here at
 * the router level rather than just by convention, see
 * docs/SPEC.md#singles. `ensureSeeded` is awaited on every request rather
 * than once at construction, since `oxygen()` itself stays a synchronous
 * factory (see docs/SPEC.md#schema--migrations) and can't block on the
 * async seed insert before returning.
 */
export function createSingleRouter(
  resource: ResolvedResource,
  db: OxygenDatabase,
  ensureSeeded: () => Promise<void>,
  permissions?: PermissionsStrategy,
): Hono {
  const app = new Hono()

  app.get('/', async (c) => {
    await ensureSeeded()
    const grant = await requireGrant(db, c, permissions, resource, 'read')
    if (grant instanceof Response) return grant
    const doc = await getDocument(db, resource, undefined, grant.scope)
    if (!doc) return notFound(c)
    return c.json(pickAllowedFields(doc, grant.fields))
  })

  app.patch('/', async (c) => {
    await ensureSeeded()
    const grant = await requireGrant(db, c, permissions, resource, 'update')
    if (grant instanceof Response) return grant
    const body = await readJsonBody(c)
    if (!body) return errorResponse(c, 400, [{ message: 'Request body must be a JSON object.' }])
    const fieldError = rejectDisallowedFields(c, body, grant.fields)
    if (fieldError) return fieldError
    try {
      const doc = await updateDocument(db, resource, body, undefined, grant.scope)
      if (!doc) return notFound(c)
      return c.json({ message: `${resource.slug} updated.`, doc: pickAllowedFields(doc, grant.fields) })
    } catch (error) {
      if (error instanceof ValidationFailure) return errorResponse(c, 400, error.errors)
      if (isUniqueConstraintError(error)) {
        return errorResponse(c, 409, [{ message: 'A document with this value already exists.' }])
      }
      if (isForeignKeyConstraintError(error)) {
        return errorResponse(c, 409, [{ message: 'This document is referenced by, or references, another document.' }])
      }
      throw error
    }
  })

  return app
}
