import type {
  ArrayDescriptor,
  BlocksDescriptor,
  DateDescriptor,
  FieldDescriptor,
  GroupDescriptor,
  NumberDescriptor,
  RelationDescriptor,
  SelectDescriptor,
  TextDescriptor,
  UploadDescriptor,
} from '@deadly-studio/oxygen-fields'
import type { ResolvedResource } from './schema.js'

/**
 * A JSON-safe projection of a `FieldDescriptor` for the admin UI
 * (docs/BUILD_PLAN.md#12-stretch-admin-ui) to render forms/tables from —
 * functions (`.validate()`, `.condition()`, a `select()` loader) can't cross
 * JSON, so those become booleans/omissions instead. Not part of
 * docs/SPEC.md's v1 REST surface (that doc explicitly defers the admin UI to
 * "a separate spec when it starts") — this is the minimal schema-discovery
 * endpoint that surface actually needs to exist at all.
 */
export interface SerializedField {
  kind: string
  required: boolean
  unique: boolean
  indexed: boolean
  hasDefault: boolean
  hasCondition: boolean
  [extra: string]: unknown
}

function serializeField(descriptor: FieldDescriptor): SerializedField {
  const base: SerializedField = {
    kind: descriptor.kind,
    required: descriptor.required,
    unique: descriptor.unique,
    indexed: descriptor.indexed,
    hasDefault: descriptor.default !== undefined,
    hasCondition: descriptor.condition !== undefined,
  }

  switch (descriptor.kind) {
    case 'text':
    case 'textarea': {
      const d = descriptor as TextDescriptor
      return { ...base, minLength: d.minLength, maxLength: d.maxLength, matches: d.matches?.source }
    }
    case 'number': {
      const d = descriptor as NumberDescriptor
      return { ...base, int: d.int, min: d.min, max: d.max }
    }
    case 'select': {
      const d = descriptor as SelectDescriptor
      return {
        ...base,
        hasMany: d.hasMany,
        options: typeof d.options === 'function' ? 'loader' : d.options,
      }
    }
    case 'date':
    case 'timestamp': {
      const d = descriptor as DateDescriptor
      return { ...base, min: d.min?.toISOString(), max: d.max?.toISOString() }
    }
    case 'relation': {
      const d = descriptor as RelationDescriptor
      return { ...base, to: d.to, hasMany: d.hasMany, onDelete: d.onDelete }
    }
    case 'upload': {
      const d = descriptor as UploadDescriptor
      return { ...base, adapter: d.adapter, accept: d.accept }
    }
    case 'group': {
      const d = descriptor as GroupDescriptor
      return { ...base, fields: serializeFields(d.fields) }
    }
    case 'array': {
      const d = descriptor as ArrayDescriptor
      return { ...base, fields: serializeFields(d.fields), minRows: d.minRows, maxRows: d.maxRows }
    }
    case 'blocks': {
      const d = descriptor as BlocksDescriptor
      return {
        ...base,
        blocks: Object.fromEntries(Object.entries(d.blocks).map(([blockType, fields]) => [blockType, serializeFields(fields)])),
        minRows: d.minRows,
        maxRows: d.maxRows,
      }
    }
    default:
      return base
  }
}

export function serializeFields(fields: Record<string, FieldDescriptor>): Record<string, SerializedField> {
  return Object.fromEntries(Object.entries(fields).map(([key, descriptor]) => [key, serializeField(descriptor)]))
}

export interface SerializedResource {
  slug: string
  auth: boolean
  fields: Record<string, SerializedField>
}

export interface SchemaResponse {
  collections: SerializedResource[]
  singles: SerializedResource[]
}

function serializeResource(resource: ResolvedResource): SerializedResource {
  return { slug: resource.slug, auth: resource.auth, fields: serializeFields(resource.fields) }
}

export function buildSchemaResponse(
  collections: Iterable<ResolvedResource>,
  singles: Iterable<ResolvedResource>,
): SchemaResponse {
  return {
    collections: Array.from(collections, serializeResource),
    singles: Array.from(singles, serializeResource),
  }
}
