import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { cmsRoles } from '@deadly-studio/oxygen-auth'

/**
 * See docs/SPEC.md#permissions. `scope`/`fields` are JSON columns —
 * `null` means unrestricted for that row, per BUILD_PLAN.md#6-permissions.
 * `action` is one of the `PermissionAction` values ('create'|'read'|'update'|'delete').
 */
export const cmsPermissions = sqliteTable('cms_permissions', {
  id: text('id').primaryKey(),
  roleId: text('roleId')
    .notNull()
    .references(() => cmsRoles.id, { onDelete: 'cascade' }),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
  scope: text('scope', { mode: 'json' }),
  fields: text('fields', { mode: 'json' }),
})

/** For pushing/generating physical schema alongside a consumer's own collections until docs/SPEC.md#schema--migrations' `oxygen generate` CLI exists. */
export const permissionsTables = { cmsPermissions }
