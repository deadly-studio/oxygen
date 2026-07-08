import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Framework-owned tables backing CMS user auth — see
 * docs/SPEC.md#cms-user-auth-otp--cookie-sessions. `cmsRoles`/`cmsUserRoles`
 * are the minimal slice of BUILD_PLAN.md#6-permissions' role tables pulled
 * forward: bootstrapping (docs/SPEC.md#bootstrapping-the-first-cms-user)
 * needs somewhere to record "this user is super-admin" even though scope/
 * field enforcement (`cms_permissions`, phase 7) doesn't exist yet — shaped
 * to match BUILD_PLAN.md's schema exactly so phase 7 only adds a table
 * rather than reworking these two.
 */
export const cmsUsers = sqliteTable('cms_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
})

export const cmsRoles = sqliteTable('cms_roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
})

export const cmsUserRoles = sqliteTable(
  'cms_user_roles',
  {
    userId: text('userId')
      .notNull()
      .references(() => cmsUsers.id, { onDelete: 'cascade' }),
    roleId: text('roleId')
      .notNull()
      .references(() => cmsRoles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
)

/** Shared by both auth domains via `purpose` (`cms` | `app:<slug>`) — see docs/SPEC.md#app-user-auth-otp--jwt. */
export const cmsOtpCodes = sqliteTable('cms_otp_codes', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  codeHash: text('codeHash').notNull(),
  purpose: text('purpose').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  consumedAt: integer('consumedAt', { mode: 'timestamp' }),
  attempts: integer('attempts').notNull().default(0),
})

/** One row per signed-in session; deleting a row revokes it — see docs/BUILD_PLAN.md#5-two-auth-domains. */
export const cmsSessions = sqliteTable('cms_sessions', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => cmsUsers.id, { onDelete: 'cascade' }),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
})

/** Bypasses permission checks entirely once phase 7 lands — see docs/BUILD_PLAN.md#6-permissions. Granted to the bootstrap user. */
export const SUPER_ADMIN_ROLE = 'super-admin'

/**
 * Backs the app-user refresh + rotate/revoke flow — see
 * docs/SPEC.md#app-user-auth-otp--jwt. Unlike `cmsSessions`, `userId` can't
 * carry a real FK: it points into whichever auth-enabled collection's own
 * table `collectionSlug` names (`customers`, `vendors`, ...), and Drizzle FKs
 * can't target a dynamically-chosen table. The row `id` doubles as the
 * bearer refresh token itself, same pattern as `cmsSessions.id` doubling as
 * the session cookie's value — a 26-character ULID is unguessable enough on
 * its own, so no separate hash column.
 */
export const appRefreshTokens = sqliteTable('app_refresh_tokens', {
  id: text('id').primaryKey(),
  collectionSlug: text('collectionSlug').notNull(),
  userId: text('userId').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  revokedAt: integer('revokedAt', { mode: 'timestamp' }),
})

/** For pushing/generating physical schema alongside a consumer's own collections until docs/SPEC.md#schema--migrations' `oxygen generate` CLI exists. */
export const cmsAuthTables = { cmsUsers, cmsRoles, cmsUserRoles, cmsOtpCodes, cmsSessions, appRefreshTokens }
