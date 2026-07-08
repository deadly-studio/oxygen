import { and } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { OxygenDatabase } from './database.js'
import { errorResponse } from './errors.js'
import type { ResolvedResource } from './schema.js'

export type PermissionAction = 'create' | 'read' | 'update' | 'delete'

/** What a resolved set of role grants allows for one (resource, action) pair — see docs/SPEC.md#permissions. */
export interface PermissionGrant {
  /** ANDed into the query's `where`; `undefined` means unrestricted. */
  scope?: SQL
  /** Allow-listed top-level field keys; `null` means every field is allowed. */
  fields: string[] | null
}

/**
 * Shape a pluggable permissions engine must satisfy — see
 * docs/SPEC.md#permissions. Defined here (not in
 * `@deadly-studio/oxygen-permissions`) so this package never depends on that
 * one, same pattern as `CmsAuthStrategy`/`AppAuthStrategy`. Called once per
 * request by the CRUD-generated routes, ahead of running the operation;
 * `resolve` returning `null` denies the action outright (403).
 */
export interface PermissionsStrategy {
  resolve(db: OxygenDatabase, c: Context, resource: ResolvedResource, action: PermissionAction): Promise<PermissionGrant | null>
}

/** ANDs two possibly-absent `where` conditions — a user-supplied `?where=` and a permission's `scope`, see docs/SPEC.md#permissions. */
export function combineWhere(a: SQL | undefined, b: SQL | undefined): SQL | undefined {
  if (a && b) return and(a, b)
  return a ?? b
}

const IMPLICIT_KEYS = ['id', 'createdAt', 'updatedAt']

/** Read-side field enforcement: strips any top-level key not in the allow-list, keeping the always-present implicit columns — see docs/SPEC.md#permissions. */
export function pickAllowedFields<TDoc extends Record<string, unknown>>(doc: TDoc, fields: string[] | null | undefined): TDoc {
  if (!fields) return doc
  const allowed = new Set([...fields, ...IMPLICIT_KEYS])
  return Object.fromEntries(Object.entries(doc).filter(([key]) => allowed.has(key))) as TDoc
}

const FORBIDDEN_STATUS: ContentfulStatusCode = 403

/**
 * Resolves the grant for one route handler, or the 403 `Response` to return
 * in its place. `permissions` unconfigured means unrestricted access (no
 * enforcement at all), matching every phase before this one — callers check
 * `result instanceof Response` before proceeding.
 */
export async function requireGrant(
  db: OxygenDatabase,
  c: Context,
  permissions: PermissionsStrategy | undefined,
  resource: ResolvedResource,
  action: PermissionAction,
): Promise<PermissionGrant | Response> {
  if (!permissions) return { fields: null }
  const grant = await permissions.resolve(db, c, resource, action)
  if (!grant) return errorResponse(c, FORBIDDEN_STATUS, [{ message: 'Forbidden.' }])
  return grant
}

/** Write-side field enforcement: a payload touching a disallowed field is rejected outright rather than silently dropped, see docs/SPEC.md#permissions. */
export function rejectDisallowedFields(
  c: Context,
  body: Record<string, unknown>,
  fields: string[] | null | undefined,
): Response | undefined {
  if (!fields) return undefined
  const allowed = new Set(fields)
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return errorResponse(c, FORBIDDEN_STATUS, [{ field: key, message: `Field '${key}' is not writable by your role.` }])
    }
  }
  return undefined
}
