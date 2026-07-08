// The one module in this package that imports drizzle-orm — see
// docs/FIELDS.md#translation-layer-contract. Everything above this file
// (builders, descriptors, validation, type inference) works purely in terms
// of FieldDescriptor and never touches Drizzle.
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { AnySQLiteColumn, AnySQLiteTable, SQLiteColumnBuilderBase } from 'drizzle-orm/sqlite-core'
import { UPLOAD_SUFFIXES } from './collision.js'
import type {
  FieldDescriptor,
  GroupDescriptor,
  NumberDescriptor,
  RelationDescriptor,
  RelationOnDelete,
  SelectDescriptor,
  TextDescriptor,
  UploadDescriptor,
} from './descriptor.js'

export interface TranslateContext {
  /** Resolves a collection/single slug to its already-built table's `id` column, for relation() FK targets. */
  tableFor: (slug: string) => { id: AnySQLiteColumn }
}

function mapOnDelete(action: RelationOnDelete): 'restrict' | 'set null' | 'cascade' {
  if (action === 'setNull') return 'set null'
  return action
}

// Applying default/$defaultFn/notNull/unique is generic over drizzle's column
// builder hierarchy, whose exact type varies per column kind — narrowed here
// to the handful of chainable methods every sqlite column builder shares.
interface ChainableColumnBuilder {
  notNull(): ChainableColumnBuilder
  unique(): ChainableColumnBuilder
  default(value: unknown): ChainableColumnBuilder
  $defaultFn(fn: () => unknown): ChainableColumnBuilder
}

function applyCommon(column: SQLiteColumnBuilderBase, descriptor: FieldDescriptor): SQLiteColumnBuilderBase {
  let col = column as unknown as ChainableColumnBuilder
  if (descriptor.required) col = col.notNull()
  if (descriptor.unique) col = col.unique()
  if (descriptor.default !== undefined) {
    col = typeof descriptor.default === 'function' ? col.$defaultFn(descriptor.default as () => unknown) : col.default(descriptor.default)
  }
  return col as unknown as SQLiteColumnBuilderBase
}

function translateLeaf(
  key: string,
  columnName: string,
  descriptor: FieldDescriptor,
  ctx: TranslateContext,
): SQLiteColumnBuilderBase {
  switch (descriptor.kind) {
    case 'text':
    case 'textarea':
    case 'richText': {
      const d = descriptor as TextDescriptor
      const col = d.maxLength !== undefined ? text(columnName, { length: d.maxLength }) : text(columnName)
      return applyCommon(col, descriptor)
    }
    case 'json':
      return applyCommon(text(columnName, { mode: 'json' }), descriptor)
    case 'number': {
      const d = descriptor as NumberDescriptor
      return applyCommon(d.int ? integer(columnName) : real(columnName), descriptor)
    }
    case 'boolean':
      return applyCommon(integer(columnName, { mode: 'boolean' }), descriptor)
    case 'date':
    case 'timestamp':
      return applyCommon(integer(columnName, { mode: 'timestamp' }), descriptor)
    case 'select': {
      const d = descriptor as SelectDescriptor
      return applyCommon(d.hasMany ? text(columnName, { mode: 'json' }) : text(columnName), descriptor)
    }
    case 'relation': {
      const d = descriptor as RelationDescriptor
      if (d.hasMany) return applyCommon(text(columnName, { mode: 'json' }), descriptor)
      const col = text(columnName).references(() => ctx.tableFor(d.to).id, {
        onDelete: mapOnDelete(d.onDelete),
      })
      return applyCommon(col, descriptor)
    }
    case 'array':
    case 'blocks':
      return applyCommon(text(columnName, { mode: 'json' }), descriptor)
    default:
      throw new Error(`translate: field '${key}' has unhandled kind '${descriptor.kind}'.`)
  }
}

/**
 * Walks a field map to Drizzle sqlite-core column builders, flattening
 * group() into prefixed columns and upload() into its 4 fixed columns —
 * array()/blocks() collapse to one JSON column, never additional columns.
 */
export function translateFields(
  fields: Record<string, FieldDescriptor>,
  ctx: TranslateContext,
  prefix = '',
  out: Record<string, SQLiteColumnBuilderBase> = {},
): Record<string, SQLiteColumnBuilderBase> {
  for (const [key, descriptor] of Object.entries(fields)) {
    const columnName = `${prefix}${key}`
    if (descriptor.kind === 'group') {
      translateFields((descriptor as GroupDescriptor).fields, ctx, `${columnName}_`, out)
      continue
    }
    if (descriptor.kind === 'upload') {
      // required()/unique()/default() describe "is an upload present", which
      // only has a well-defined meaning on the `key` column — filename/
      // mimeType/filesize are always set alongside it at the application
      // layer, never independently constrained.
      const d = descriptor as UploadDescriptor
      for (const suffix of UPLOAD_SUFFIXES) {
        const uploadColumnName = `${columnName}_${suffix}`
        const col = suffix === 'filesize' ? integer(uploadColumnName) : text(uploadColumnName)
        out[uploadColumnName] = suffix === 'key' ? applyCommon(col, d) : col
      }
      continue
    }
    out[columnName] = translateLeaf(key, columnName, descriptor, ctx)
  }
  return out
}

/**
 * A collection/single's full table: the implicit id/createdAt/updatedAt
 * columns (see docs/SPEC.md#primary-keys) plus the translated field columns.
 */
export function buildTable(slug: string, fields: Record<string, FieldDescriptor>, ctx: TranslateContext) {
  return sqliteTable(slug, {
    id: text('id').primaryKey(),
    ...translateFields(fields, ctx),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
  })
}

export interface SchemaSource {
  slug: string
  fields: Record<string, FieldDescriptor>
}

/**
 * Builds every collection/single's table in one pass, wiring relation() FKs
 * across them via a lazily-resolved `tableFor` — safe for forward and
 * self-references since `.references()` only calls it once every table in
 * this batch already exists, see docs/SPEC.md#schema--migrations.
 */
export function buildSchema(sources: SchemaSource[]): Record<string, AnySQLiteTable> {
  const tables: Record<string, ReturnType<typeof buildTable>> = {}
  const ctx: TranslateContext = {
    tableFor: (slug) => {
      const table = tables[slug]
      if (!table) throw new Error(`translate: relation() targets unknown collection/single '${slug}'.`)
      return table
    },
  }
  for (const source of sources) {
    tables[source.slug] = buildTable(source.slug, source.fields, ctx)
  }
  return tables
}
