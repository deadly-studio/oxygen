// Phase 8 — typed REST client — see docs/BUILD_PLAN.md

export type { AppAuthClient, AppTokenPair } from './app-auth.js'
export type { CmsAuthClient, CmsUser } from './cms-auth.js'
export { CollectionClient } from './collection.js'
export type { FindParams, ListResult, SelectOptionsResult } from './collection.js'
export { createClient } from './client.js'
export type { AuthClient, Client, CreateClientOptions } from './client.js'
export { ApiRequestError } from './http.js'
export type { ApiError } from './http.js'
export type { AuthCollectionKeys, CollectionKeys, ResourceDoc, ResourceMap, SingleKeys } from './resources.js'
export { SingleClient } from './single.js'
export type { FilterOperator, WhereFilter } from './where.js'
export type { Wire, WithTimestamps } from './wire.js'
