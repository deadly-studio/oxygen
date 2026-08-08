import { apiRequest } from './http.js'
import type { HttpOptions } from './http.js'

/** The fixed, framework-owned `cms_users` shape — see docs/SPEC.md#cms-user-auth-otp--cookie-sessions. */
export interface CmsUser {
  id: string
  email: string
  createdAt: string
  updatedAt: string
}

export interface CmsAuthClient {
  otp: {
    request(email: string): Promise<{ message: string }>
    verify(email: string, code: string): Promise<{ user: CmsUser }>
  }
  logout(): Promise<{ message: string }>
  me(): Promise<{ user: CmsUser }>
}

/** `client.auth.cms` — see docs/SPEC.md#cms-user-auth-otp--cookie-sessions. Session state lives in the signed httpOnly cookie the server sets, not here. */
export function createCmsAuthClient(http: HttpOptions): CmsAuthClient {
  return {
    otp: {
      request: (email) => apiRequest(http, { method: 'POST', path: '/auth/otp/request', body: { email } }),
      verify: (email, code) =>
        apiRequest(http, { method: 'POST', path: '/auth/otp/verify', body: { email, code } }),
    },
    logout: () => apiRequest(http, { method: 'POST', path: '/auth/logout' }),
    me: () => apiRequest(http, { method: 'GET', path: '/auth/me' }),
  }
}
