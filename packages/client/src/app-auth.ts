import type { CollectionConfig } from '@deadly-studio/oxygen-fields'
import { apiRequest } from './http.js'
import type { HttpOptions } from './http.js'
import type { ResourceDoc } from './resources.js'

export interface AppTokenPair {
  accessToken: string
  refreshToken: string
}

export interface AppAuthClient<TConfig extends CollectionConfig> {
  otp: {
    request(identifier: string): Promise<{ message: string }>
    verify(identifier: string, code: string): Promise<AppTokenPair & { user: ResourceDoc<TConfig> }>
  }
  refresh(refreshToken: string): Promise<AppTokenPair>
  logout(refreshToken: string): Promise<{ message: string }>
}

/**
 * `client.auth.app(slug)` — see docs/SPEC.md#app-user-auth-otp--jwt. Only
 * issues/rotates tokens; threading the resulting `accessToken` into
 * `collection()`/`single()` calls is the caller's job via `createClient`'s
 * `accessToken` option (this client has no notion of "the current session").
 */
export function createAppAuthClient<TConfig extends CollectionConfig>(
  http: HttpOptions,
  slug: string,
): AppAuthClient<TConfig> {
  const path = `/app/${slug}/auth`
  return {
    otp: {
      request: (identifier) =>
        apiRequest(http, { method: 'POST', path: `${path}/otp/request`, body: { identifier } }),
      verify: (identifier, code) =>
        apiRequest(http, { method: 'POST', path: `${path}/otp/verify`, body: { identifier, code } }),
    },
    refresh: (refreshToken) =>
      apiRequest(http, { method: 'POST', path: `${path}/refresh`, body: { refreshToken } }),
    logout: (refreshToken) => apiRequest(http, { method: 'POST', path: `${path}/logout`, body: { refreshToken } }),
  }
}
