import type { PermissionsStrategy } from '@deadly-studio/oxygen'
import { resolveGrantForPrincipal } from './grant.js'
import { resolvePrincipal } from './principal.js'

export interface RolePermissionsOptions {
  /**
   * Identifies a CMS-session principal directly (see `resolvePrincipal`) —
   * must match the `cookieSecret` passed to `otpAuth()`. Omit if no
   * `auth.cms` is configured.
   */
  cookieSecret?: string
  /**
   * Identifies an app-user bearer-JWT principal directly — must match the
   * `jwtSecret` passed to `appOtpAuth()`. Omit if there are no auth-enabled
   * collections.
   */
  jwtSecret?: string
}

/**
 * The DB-backed roles/permissions `PermissionsStrategy` — see
 * docs/SPEC.md#permissions. Structurally satisfies
 * `@deadly-studio/oxygen`'s `PermissionsStrategy` interface without that
 * package depending on this one, same pattern as `otpAuth`/`appOtpAuth`.
 */
export function rolePermissions(options: RolePermissionsOptions): PermissionsStrategy {
  return {
    async resolve(db, c, resource, action) {
      const principal = await resolvePrincipal(db, c, options)
      if (!principal) return null
      return resolveGrantForPrincipal(db, resource, action, principal)
    },
  }
}
