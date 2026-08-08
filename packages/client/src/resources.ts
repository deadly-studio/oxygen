import type { CollectionConfig, FieldDescriptor, InferFields, SingleConfig } from '@deadly-studio/oxygen-fields'
import type { Wire, WithTimestamps } from './wire.js'

/** The map passed as `createClient`'s type parameter — see docs/SPEC.md#typed-client. */
export type ResourceMap = Record<string, CollectionConfig | SingleConfig>

export type CollectionKeys<TResources extends ResourceMap> = {
  [K in keyof TResources]: TResources[K] extends CollectionConfig ? K : never
}[keyof TResources]

export type SingleKeys<TResources extends ResourceMap> = {
  [K in keyof TResources]: TResources[K] extends SingleConfig ? K : never
}[keyof TResources]

/** Auth-enabled (`auth: true`) collections — the only ones `client.auth.app(slug)` accepts. */
export type AuthCollectionKeys<TResources extends ResourceMap> = {
  [K in keyof TResources]: TResources[K] extends CollectionConfig<string, Record<string, FieldDescriptor>, true>
    ? K
    : never
}[keyof TResources]

/** A resource's response document shape: implicit id/createdAt/updatedAt plus its wire-serialized fields. */
export type ResourceDoc<TConfig extends CollectionConfig | SingleConfig> = WithTimestamps<
  Wire<InferFields<TConfig['fields']>>
>
