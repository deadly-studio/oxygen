import { eq } from 'drizzle-orm'
import { ulid } from '@deadly-studio/oxygen'
import type { OxygenDatabase } from '@deadly-studio/oxygen'
import { cmsRoles } from '@deadly-studio/oxygen-auth'

/**
 * Implicit default role every app user holds — see docs/SPEC.md#permissions.
 * There's no v1 mechanism to assign an app user a role explicitly:
 * `cms_user_roles.userId` has an FK to `cms_users` only, and app users are
 * rows in an arbitrary auth-enabled collection instead, so `self` always
 * applies to them, unconditionally.
 */
export const SELF_ROLE = 'self'

/**
 * Seeds the `self` role on first use and returns its id. Idempotent via the
 * unique `name` column, same as `cms_roles`' super-admin seeding in
 * `@deadly-studio/oxygen-auth`'s bootstrap flow — there's no equivalent
 * "first request" hook for this role, so it just seeds lazily whenever an
 * app-user principal is first resolved.
 */
export async function ensureSelfRoleId(db: OxygenDatabase): Promise<string> {
  const existing = await db.select().from(cmsRoles).where(eq(cmsRoles.name, SELF_ROLE)).get()
  if (existing) return existing.id

  await db.insert(cmsRoles).values({ id: ulid(), name: SELF_ROLE }).onConflictDoNothing({ target: cmsRoles.name })
  const row = await db.select().from(cmsRoles).where(eq(cmsRoles.name, SELF_ROLE)).get()
  return row!.id
}
