import { sealFields } from './builder.js'
import type { FieldMap, SealFieldMap } from './builder.js'
import { assertNoColumnCollisions } from './collision.js'
import type { ArrayDescriptor, FieldDescriptor, GroupDescriptor, RelationDescriptor } from './descriptor.js'
import type { InferFields } from './infer.js'

export type HookOperation = 'create' | 'update'

export interface HookContext<TDoc> {
  operation: HookOperation
  previousDoc?: TDoc
}

export type BeforeHook<TDoc> = (
  data: Partial<TDoc>,
  ctx: HookContext<TDoc>,
) => Partial<TDoc> | Promise<Partial<TDoc>>
export type AfterChangeHook<TDoc> = (doc: TDoc, ctx: HookContext<TDoc>) => void
export type DocHook<TDoc> = (doc: TDoc) => void

/** See docs/SPEC.md#hook-lifecycle. */
export interface Hooks<TDoc> {
  beforeValidate?: BeforeHook<TDoc>[]
  beforeChange?: BeforeHook<TDoc>[]
  afterChange?: AfterChangeHook<TDoc>[]
  beforeDelete?: DocHook<TDoc>[]
  afterDelete?: DocHook<TDoc>[]
  afterRead?: DocHook<TDoc>[]
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/

function assertValidSlug(slug: string, kind: 'collection' | 'single'): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`${kind} slug '${slug}' is invalid — must match ${SLUG_PATTERN} ([a-z][a-z0-9-]*).`)
  }
}

function assertRelationOnDeleteValidity(
  fields: Record<string, FieldDescriptor>,
  ownerLabel: string,
  path: string[] = [],
): void {
  for (const [key, descriptor] of Object.entries(fields)) {
    const fieldPath = [...path, key].join('.')
    if (descriptor.kind === 'relation') {
      const relation = descriptor as RelationDescriptor
      if (!relation.hasMany && relation.onDelete === 'setNull' && relation.required) {
        throw new Error(
          `${ownerLabel}: field '${fieldPath}' can't combine .required() with .onDelete('setNull') — ` +
            "a required relation can never be nulled out. Use 'restrict' or 'cascade' instead.",
        )
      }
    } else if (descriptor.kind === 'group' || descriptor.kind === 'array') {
      assertRelationOnDeleteValidity(
        (descriptor as GroupDescriptor | ArrayDescriptor).fields,
        ownerLabel,
        [...path, key],
      )
    } else if (descriptor.kind === 'blocks') {
      const blocksDescriptor = descriptor as unknown as {
        blocks: Record<string, Record<string, FieldDescriptor>>
      }
      for (const [blockType, blockFields] of Object.entries(blocksDescriptor.blocks)) {
        assertRelationOnDeleteValidity(blockFields, ownerLabel, [...path, key, blockType])
      }
    }
  }
}

export interface CollectionConfig<
  TSlug extends string = string,
  F extends Record<string, FieldDescriptor> = Record<string, FieldDescriptor>,
  TAuth extends boolean = boolean,
> {
  readonly type: 'collection'
  slug: TSlug
  auth: TAuth
  fields: F
  hooks?: Hooks<InferFields<F>>
}

export interface CollectionInput<
  TSlug extends string = string,
  F extends FieldMap = FieldMap,
  TAuth extends boolean = boolean,
> {
  slug: TSlug
  fields: F
  auth?: TAuth
  hooks?: Hooks<InferFields<SealFieldMap<F>>>
}

/** See docs/SPEC.md#definecollection. */
export function defineCollection<TSlug extends string, F extends FieldMap, TAuth extends boolean = false>(
  input: CollectionInput<TSlug, F, TAuth>,
): CollectionConfig<TSlug, SealFieldMap<F>, TAuth> {
  assertValidSlug(input.slug, 'collection')
  const fields = sealFields(input.fields)
  assertNoColumnCollisions(fields, `collection '${input.slug}'`)
  assertRelationOnDeleteValidity(fields, `collection '${input.slug}'`)
  return {
    type: 'collection',
    slug: input.slug,
    auth: (input.auth ?? false) as TAuth,
    fields,
    hooks: input.hooks,
  }
}

export interface SingleConfig<
  TSlug extends string = string,
  F extends Record<string, FieldDescriptor> = Record<string, FieldDescriptor>,
> {
  readonly type: 'single'
  slug: TSlug
  fields: F
  hooks?: Hooks<InferFields<F>>
}

export interface SingleInput<TSlug extends string = string, F extends FieldMap = FieldMap> {
  slug: TSlug
  fields: F
  hooks?: Hooks<InferFields<SealFieldMap<F>>>
}

/** See docs/SPEC.md#definesingle. */
export function defineSingle<TSlug extends string, F extends FieldMap>(
  input: SingleInput<TSlug, F>,
): SingleConfig<TSlug, SealFieldMap<F>> {
  assertValidSlug(input.slug, 'single')
  const fields = sealFields(input.fields)
  assertNoColumnCollisions(fields, `single '${input.slug}'`)
  assertRelationOnDeleteValidity(fields, `single '${input.slug}'`)
  return {
    type: 'single',
    slug: input.slug,
    fields,
    hooks: input.hooks,
  }
}

/**
 * A documented convention more than a runtime helper — a typed identity
 * function. Each call to the returned factory produces fresh builder
 * instances, so per-site customization can't mutate a shared field, see
 * docs/FIELDS.md#reusing-fields-across-collections.
 */
export function defineFields<F extends FieldMap>(factory: () => F): () => F {
  return factory
}

export type InferDoc<T extends CollectionConfig | SingleConfig> = InferFields<T['fields']>
