// Phase 7 — roles/permissions tables, scope-filter + field allow-list enforcement — see docs/BUILD_PLAN.md
export { rolePermissions } from './rbac.js'
export type { RolePermissionsOptions } from './rbac.js'
export { cmsPermissions, permissionsTables } from './tables.js'
export { ensureSelfRoleId, SELF_ROLE } from './self-role.js'
