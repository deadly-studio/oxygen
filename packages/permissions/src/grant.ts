import { and, eq, inArray, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { buildWhere } from '@deadly-studio/oxygen'
import type { OxygenDatabase, PermissionAction, PermissionGrant, ResolvedResource } from '@deadly-studio/oxygen'
import { SUPER_ADMIN_ROLE } from '@deadly-studio/oxygen-auth'
import type { Principal } from './principal.js'
import { substituteCurrentUser } from './scope.js'
import { cmsPermissions } from './tables.js'

/**
 * Implements docs/SPEC.md#permissions' enforcement algorithm: super-admin
 * bypasses everything; otherwise gather every `cms_permissions` row
 * matching `(resource, action)` for the principal's roles (none → deny);
 * OR their scopes together (any `null` scope makes the combined result
 * unrestricted, since "no restriction" is a superset of everything else an
 * OR could add); union their field allow-lists (any `null` makes the
 * result "all fields").
 */
export async function resolveGrantForPrincipal(
  db: OxygenDatabase,
  resource: ResolvedResource,
  action: PermissionAction,
  principal: Principal,
): Promise<PermissionGrant | null> {
  if (principal.roles.some((role) => role.name === SUPER_ADMIN_ROLE)) {
    return { fields: null }
  }

  const roleIds = principal.roles.map((role) => role.id)
  if (roleIds.length === 0) return null

  const rows = await db
    .select()
    .from(cmsPermissions)
    .where(and(eq(cmsPermissions.resource, resource.slug), eq(cmsPermissions.action, action), inArray(cmsPermissions.roleId, roleIds)))
    .all()
  if (rows.length === 0) return null

  let scopeUnrestricted = false
  const scopeClauses: SQL[] = []
  let fields: string[] | null = []

  for (const row of rows) {
    if (row.scope == null) {
      scopeUnrestricted = true
    } else if (!scopeUnrestricted) {
      const resolved = substituteCurrentUser(row.scope, principal.userId)
      const clause = buildWhere(resource.columns, resolved)
      if (clause) scopeClauses.push(clause)
    }

    if (row.fields == null) {
      fields = null
    } else if (fields !== null) {
      fields = [...new Set([...fields, ...(row.fields as string[])])]
    }
  }

  const scope = scopeUnrestricted
    ? undefined
    : scopeClauses.length === 0
      ? undefined
      : scopeClauses.length === 1
        ? scopeClauses[0]
        : or(...scopeClauses)

  return { scope, fields }
}
