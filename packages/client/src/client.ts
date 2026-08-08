import type { CollectionConfig, SingleConfig } from '@deadly-studio/oxygen-fields'
import { createAppAuthClient } from './app-auth.js'
import type { AppAuthClient } from './app-auth.js'
import { createCmsAuthClient } from './cms-auth.js'
import type { CmsAuthClient } from './cms-auth.js'
import { CollectionClient } from './collection.js'
import type { FetchLike, HttpOptions } from './http.js'
import type { AuthCollectionKeys, CollectionKeys, ResourceMap, SingleKeys } from './resources.js'
import { SingleClient } from './single.js'

export interface CreateClientOptions {
  baseUrl: string
  /** Defaults to the global `fetch` — override for environments without one, or to inject a cookie-jar-aware implementation for CMS auth outside a browser. */
  fetch?: FetchLike
  /** Defaults to `'include'`, matching the CMS auth cookie flow — see docs/SPEC.md#cms-user-auth-otp--cookie-sessions. */
  credentials?: NonNullable<RequestInit['credentials']>
  /**
   * Threaded as `Authorization: Bearer <token>` on every request — see
   * docs/SPEC.md#app-user-auth-otp--jwt. A function is re-read per request,
   * so a rotated token (from `client.auth.app(slug).refresh()`) takes effect
   * without recreating the client.
   */
  accessToken?: string | (() => string | undefined)
}

export interface AuthClient<TResources extends ResourceMap> {
  cms: CmsAuthClient
  app<K extends AuthCollectionKeys<TResources>>(slug: K): AppAuthClient<Extract<TResources[K], CollectionConfig>>
}

export interface Client<TResources extends ResourceMap> {
  collection<K extends CollectionKeys<TResources>>(
    slug: K,
  ): CollectionClient<Extract<TResources[K], CollectionConfig>>
  single<K extends SingleKeys<TResources>>(slug: K): SingleClient<Extract<TResources[K], SingleConfig>>
  auth: AuthClient<TResources>
}

/**
 * See docs/SPEC.md#typed-client. `TResources` is supplied purely as a type
 * parameter (`createClient<{ posts: typeof Posts }>(...)`) — the actual
 * collection/single config objects never need to reach the client at
 * runtime, only their types.
 */
export function createClient<TResources extends ResourceMap>(options: CreateClientOptions): Client<TResources> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (!fetchImpl) {
    throw new Error('createClient: no fetch implementation available in this environment — pass one via options.fetch.')
  }

  const http: HttpOptions = {
    baseUrl: options.baseUrl,
    fetch: fetchImpl,
    credentials: options.credentials,
    headers: () => {
      const token = typeof options.accessToken === 'function' ? options.accessToken() : options.accessToken
      return token ? { Authorization: `Bearer ${token}` } : undefined
    },
  }

  return {
    collection: (slug) => new CollectionClient(http, slug as string),
    single: (slug) => new SingleClient(http, slug as string),
    auth: {
      cms: createCmsAuthClient(http),
      app: (slug) => createAppAuthClient(http, slug as string),
    },
  } as Client<TResources>
}
