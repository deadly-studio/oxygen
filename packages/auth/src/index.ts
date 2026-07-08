// Phase 5 — CMS user auth (OTP, cookie sessions) — see docs/BUILD_PLAN.md
export { otpAuth, CMS_USER_CONTEXT_KEY } from './cms-auth.js'
export type { OtpAuthOptions } from './cms-auth.js'
export type { CmsUser } from './session.js'
export { cmsUsers, cmsRoles, cmsUserRoles, cmsOtpCodes, cmsSessions, cmsAuthTables, SUPER_ADMIN_ROLE } from './tables.js'
