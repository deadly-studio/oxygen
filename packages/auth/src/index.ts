// Phases 5-6 — CMS user auth (OTP, cookie sessions) + app user auth (OTP, JWT) — see docs/BUILD_PLAN.md
export { otpAuth, CMS_USER_CONTEXT_KEY } from './cms-auth.js'
export type { OtpAuthOptions } from './cms-auth.js'
export type { CmsUser } from './session.js'
export { appOtpAuth } from './app-auth.js'
export type { AppOtpAuthOptions } from './app-auth.js'
export { verifyAccessToken } from './app-tokens.js'
export type { AppTokenPair, AppTokenPayload } from './app-tokens.js'
export {
  cmsUsers,
  cmsRoles,
  cmsUserRoles,
  cmsOtpCodes,
  cmsSessions,
  appRefreshTokens,
  cmsAuthTables,
  SUPER_ADMIN_ROLE,
} from './tables.js'
