import { UPLOAD_SUFFIXES } from '@deadly-studio/oxygen-fields'
import type {
  ArrayDescriptor,
  BlocksDescriptor,
  FieldDescriptor,
  GroupDescriptor,
} from '@deadly-studio/oxygen-fields'

type Doc = Record<string, unknown>

function coerceValue(descriptor: FieldDescriptor, value: unknown): unknown {
  if (value === undefined || value === null) return value
  switch (descriptor.kind) {
    case 'date':
    case 'timestamp':
      return value instanceof Date ? value : new Date(value as string | number)
    case 'group':
      return coerceDoc((descriptor as GroupDescriptor).fields, (value as Doc) ?? {})
    case 'array': {
      const d = descriptor as ArrayDescriptor
      return (value as Doc[]).map((item) => coerceDoc(d.fields, item ?? {}))
    }
    case 'blocks': {
      const d = descriptor as BlocksDescriptor
      return (value as (Doc & { blockType: string })[]).map((item) => {
        const shape = d.blocks[item.blockType]
        return shape ? { ...coerceDoc(shape, item), blockType: item.blockType } : item
      })
    }
    default:
      return value
  }
}

/**
 * Walks a JSON request body against its field map, converting wire-format
 * values (JSON has no Date) into the typed shape the field system's
 * validator and the translation layer's columns expect — see
 * docs/FIELDS.md#type-inference. Keys absent from `data` stay absent, so a
 * PATCH's untouched fields are distinguishable from fields explicitly
 * cleared.
 */
export function coerceDoc(fields: Record<string, FieldDescriptor>, data: Doc): Doc {
  const out: Doc = {}
  for (const [key, descriptor] of Object.entries(fields)) {
    if (!(key in data)) continue
    out[key] = coerceValue(descriptor, data[key])
  }
  return out
}

/**
 * Lowers a coerced document to a flat row matching the translated table's
 * columns (docs/FIELDS.md#translation-layer-contract) — group() flattens
 * into prefixed columns, upload() into its 4 fixed columns. A key absent
 * from `doc` is omitted from the row entirely (not set to null) so the
 * column's own `.default()`/`$defaultFn` can apply on insert, and so a PATCH
 * only touches the columns it actually changes.
 */
export function docToRow(fields: Record<string, FieldDescriptor>, doc: Doc, prefix = '', out: Doc = {}): Doc {
  for (const [key, descriptor] of Object.entries(fields)) {
    const columnName = `${prefix}${key}`
    if (!(key in doc)) continue
    const value = doc[key]
    if (descriptor.kind === 'group') {
      docToRow((descriptor as GroupDescriptor).fields, (value as Doc) ?? {}, `${columnName}_`, out)
      continue
    }
    if (descriptor.kind === 'upload') {
      const upload = value as { key: string; filename: string; mimeType: string; filesize: number } | null
      for (const suffix of UPLOAD_SUFFIXES) {
        out[`${columnName}_${suffix}`] = upload ? upload[suffix] : null
      }
      continue
    }
    out[columnName] = value
  }
  return out
}

/**
 * The inverse of `docToRow`: rebuilds the nested document shape from a flat
 * DB row. Timestamp columns already come back as `Date` and JSON-mode
 * columns already come back parsed (drizzle's job, see translate.ts) — this
 * only has to undo the group/upload flattening. `id`/`createdAt`/`updatedAt`
 * are implicit (docs/SPEC.md#primary-keys) — not part of any field map, so
 * they're copied straight across, only at the top level (an empty prefix;
 * nested group() recursion never surfaces them).
 */
export function rowToDoc(fields: Record<string, FieldDescriptor>, row: Doc, prefix = ''): Doc {
  const doc: Doc = prefix === '' ? { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt } : {}
  for (const [key, descriptor] of Object.entries(fields)) {
    const columnName = `${prefix}${key}`
    if (descriptor.kind === 'group') {
      doc[key] = rowToDoc((descriptor as GroupDescriptor).fields, row, `${columnName}_`)
      continue
    }
    if (descriptor.kind === 'upload') {
      const uploadKey = row[`${columnName}_key`]
      doc[key] =
        uploadKey != null
          ? {
              key: uploadKey,
              filename: row[`${columnName}_filename`],
              mimeType: row[`${columnName}_mimeType`],
              filesize: row[`${columnName}_filesize`],
            }
          : null
      continue
    }
    doc[key] = row[columnName] ?? null
  }
  return doc
}
