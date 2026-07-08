import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { OxygenDatabase } from '@deadly-studio/oxygen'
import { cmsRoles, cmsUserRoles, resolveSessionUser, verifyAccessToken } from '@deadly-studio/oxygen-auth'
import { ensureSelfRoleId, SELF_ROLE } from './self-role.js'

export interface RoleRef {
  id: string
  name: string
}

/** `userId` is what `$currentUser` resolves to — see docs/SPEC.md#permissions. */
export interface Principal {
  userId: string
  roles: RoleRef[]
}

export interface ResolvePrincipalOptions {
  cookieSecret?: string
  jwtSecret?: string
}

const BEARER_PREFIX = 'Bearer '

/**
 * Identifies the requesting principal and their roles, checking both auth
 * domains directly rather than depending on `oxygen()` having run either
 * auth strategy's middleware first — with a `PermissionsStrategy`
 * configured, `oxygen()` skips the CMS blocking middleware precisely so
 * this can make that call itself (see core's `oxygen.ts`), uniformly for
 * CMS sessions and app-user bearer JWTs. Returns `undefined` for an
 * unauthenticated request, which naturally denies by default (zero roles
 * matches zero `cms_permissions` rows).
 */
export async function resolvePrincipal(db: OxygenDatabase, c: Context, options: ResolvePrincipalOptions): Promise<Principal | undefined> {
  if (options.cookieSecret) {
    const cmsUser = await resolveSessionUser(c, db, options.cookieSecret)
    if (cmsUser) {
      const rows = await db
        .select({ id: cmsRoles.id, name: cmsRoles.name })
        .from(cmsUserRoles)
        .innerJoin(cmsRoles, eq(cmsUserRoles.roleId, cmsRoles.id))
        .where(eq(cmsUserRoles.userId, cmsUser.id))
        .all()
      return { userId: cmsUser.id, roles: rows }
    }
  }

  if (options.jwtSecret) {
    const authHeader = c.req.header('authorization')
    if (authHeader?.startsWith(BEARER_PREFIX)) {
      const payload = await verifyAccessToken(options.jwtSecret, authHeader.slice(BEARER_PREFIX.length))
      if (payload) {
        const selfRoleId = await ensureSelfRoleId(db)
        return { userId: payload.sub, roles: [{ id: selfRoleId, name: SELF_ROLE }] }
      }
    }
  }

  return undefined
}
