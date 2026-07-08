import { RESERVED_FIELD_NAMES } from './descriptor.js'
import type { FieldDescriptor, GroupDescriptor } from './descriptor.js'

interface ColumnOrigin {
  column: string
  fieldPath: string
}

export const UPLOAD_SUFFIXES = ['key', 'filename', 'mimeType', 'filesize'] as const

/**
 * The set of column names a field map would flatten to — recurses into
 * group() (prefixed columns) and upload() (fixed 4-column flattening), but
 * not array()/blocks() (JSON blob, no columns of their own beyond the field
 * itself), see docs/FIELDS.md#groupfields.
 */
export function computeColumnNames(
  fields: Record<string, FieldDescriptor>,
  prefix = '',
  path: string[] = [],
): ColumnOrigin[] {
  const columns: ColumnOrigin[] = []
  for (const [key, descriptor] of Object.entries(fields)) {
    const fieldPath = [...path, key].join('.')
    if (descriptor.kind === 'group') {
      columns.push(
        ...computeColumnNames((descriptor as GroupDescriptor).fields, `${prefix}${key}_`, [...path, key]),
      )
    } else if (descriptor.kind === 'upload') {
      for (const suffix of UPLOAD_SUFFIXES) {
        columns.push({ column: `${prefix}${key}_${suffix}`, fieldPath })
      }
    } else {
      columns.push({ column: `${prefix}${key}`, fieldPath })
    }
  }
  return columns
}

/**
 * Rejects reserved-name collisions (id/createdAt/updatedAt) and any two
 * fields flattening to the same column, naming both fields involved — see
 * docs/SPEC.md#primary-keys and docs/FIELDS.md#groupfields.
 */
export function assertNoColumnCollisions(fields: Record<string, FieldDescriptor>, ownerLabel: string): void {
  const seen = new Map<string, string>()
  for (const { column, fieldPath } of computeColumnNames(fields)) {
    if ((RESERVED_FIELD_NAMES as readonly string[]).includes(column)) {
      throw new Error(
        `${ownerLabel}: field '${fieldPath}' generates column '${column}', which is reserved for the ` +
          "framework-managed id/createdAt/updatedAt columns.",
      )
    }
    const existing = seen.get(column)
    if (existing) {
      throw new Error(`${ownerLabel}: fields '${existing}' and '${fieldPath}' both generate column '${column}'.`)
    }
    seen.set(column, fieldPath)
  }
}
