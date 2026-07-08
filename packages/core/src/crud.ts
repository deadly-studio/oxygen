import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { validateDocument } from '@deadly-studio/oxygen-fields'
import type { FieldError } from '@deadly-studio/oxygen-fields'
import type { OxygenDatabase } from './database.js'
import { coerceDoc, docToRow, rowToDoc } from './document.js'
import { runAfterChangeHooks, runBeforeDeleteHooks, runBeforeHooks, runDocHooks } from './hooks.js'
import type { ResolvedResource } from './schema.js'
import type { SortSpec } from './where.js'
import { ulid } from './ulid.js'

type Doc = Record<string, unknown>

/** Thrown by create/update when the document fails field validation — see docs/SPEC.md#errors. */
export class ValidationFailure extends Error {
  constructor(public readonly errors: FieldError[]) {
    super('Document failed validation.')
  }
}

/**
 * Fetches one row. `id` narrows to a single collection document; omitted, it
 * fetches a single's sole row (docs/SPEC.md#singles) — there's never more
 * than one, so no filter is needed to disambiguate. `scope` is a permission
 * grant's row-level filter (docs/SPEC.md#permissions), ANDed into the same
 * lookup — a row that exists but falls outside `scope` looks identical to a
 * missing one, same as the id-only case, rather than a separate 403.
 */
export async function getDocument(
  db: OxygenDatabase,
  resource: ResolvedResource,
  id?: string,
  scope?: SQL,
): Promise<Doc | undefined> {
  const row = await getExistingRow(db, resource, id, scope)
  if (!row) return undefined
  const doc = rowToDoc(resource.fields, row)
  runDocHooks(resource.hooks?.afterRead, doc)
  return doc
}

export interface ListParams {
  where?: SQL
  sort: SortSpec[]
  limit: number
  page: number
}

export interface ListResult {
  docs: Doc[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasPrevPage: boolean
  hasNextPage: boolean
  prevPage: number | null
  nextPage: number | null
}

/** See docs/SPEC.md#response-envelopes. */
export async function listDocuments(
  db: OxygenDatabase,
  resource: ResolvedResource,
  { where, sort, limit, page }: ListParams,
): Promise<ListResult> {
  const offset = (page - 1) * limit

  let query = db.select().from(resource.table).$dynamic()
  if (where) query = query.where(where)
  if (sort.length > 0) {
    query = query.orderBy(...sort.map((s) => (s.direction === 'desc' ? desc(s.column) : asc(s.column))))
  }
  const rows = (await query.limit(limit).offset(offset).all()) as Doc[]

  let countQuery = db.select({ count: sql<number>`count(*)` }).from(resource.table).$dynamic()
  if (where) countQuery = countQuery.where(where)
  const totalDocs = (await countQuery.get())?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalDocs / limit))

  const docs = rows.map((row) => {
    const doc = rowToDoc(resource.fields, row)
    runDocHooks(resource.hooks?.afterRead, doc)
    return doc
  })

  return {
    docs,
    totalDocs,
    limit,
    page,
    totalPages,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages,
    prevPage: page > 1 ? page - 1 : null,
    nextPage: page < totalPages ? page + 1 : null,
  }
}

/** See docs/SPEC.md#hook-lifecycle and docs/SPEC.md#primary-keys. Throws `ValidationFailure` on bad input. */
export async function createDocument(db: OxygenDatabase, resource: ResolvedResource, rawBody: Doc): Promise<Doc> {
  const coerced = coerceDoc(resource.fields, rawBody)
  const ctx = { operation: 'create' as const, previousDoc: undefined }

  const afterBeforeValidate = await runBeforeHooks(resource.hooks?.beforeValidate, coerced, ctx)
  const errors = await validateDocument(resource.fields, afterBeforeValidate, 'create')
  if (errors.length > 0) throw new ValidationFailure(errors)

  const afterBeforeChange = await runBeforeHooks(resource.hooks?.beforeChange, afterBeforeValidate, ctx)
  const now = new Date()
  const row = { ...docToRow(resource.fields, afterBeforeChange), id: ulid(), createdAt: now, updatedAt: now }

  const [insertedRow] = (await db.insert(resource.table).values(row).returning().all()) as Doc[]
  const doc = rowToDoc(resource.fields, insertedRow!)
  runAfterChangeHooks(resource.hooks?.afterChange, doc, ctx)
  return doc
}

/**
 * `id` pins the row to update. Omitted (singles), it targets whichever row
 * happens to be there — there's only ever one, see docs/SPEC.md#singles.
 * Validates the *merged* document (previous row + patch) so a PATCH that
 * doesn't touch a required field isn't rejected for "missing" it, while
 * still only ever writing the columns the patch actually named. `scope` is
 * a permission grant's row-level filter (docs/SPEC.md#permissions) — once
 * `existingRow` has been fetched through it, the actual UPDATE's own `where`
 * only needs the id (the row is already confirmed in-scope).
 */
export async function updateDocument(
  db: OxygenDatabase,
  resource: ResolvedResource,
  rawPatch: Doc,
  id?: string,
  scope?: SQL,
): Promise<Doc | undefined> {
  const existingRow = await getExistingRow(db, resource, id, scope)
  if (!existingRow) return undefined
  const previousDoc = rowToDoc(resource.fields, existingRow)
  const ctx = { operation: 'update' as const, previousDoc }

  const coercedPatch = coerceDoc(resource.fields, rawPatch)
  const afterBeforeValidate = await runBeforeHooks(resource.hooks?.beforeValidate, coercedPatch, ctx)
  const merged = { ...previousDoc, ...afterBeforeValidate }
  const errors = await validateDocument(resource.fields, merged, 'update')
  if (errors.length > 0) throw new ValidationFailure(errors)

  const afterBeforeChange = await runBeforeHooks(resource.hooks?.beforeChange, afterBeforeValidate, ctx)
  const rowPatch = { ...docToRow(resource.fields, afterBeforeChange), updatedAt: new Date() }

  const [updatedRow] = (await db
    .update(resource.table)
    .set(rowPatch)
    .where(eq(resource.columns.id!, existingRow.id as string))
    .returning()
    .all()) as Doc[]
  const doc = rowToDoc(resource.fields, updatedRow!)
  runAfterChangeHooks(resource.hooks?.afterChange, doc, ctx)
  return doc
}

/** `scope` is a permission grant's row-level filter (docs/SPEC.md#permissions) — the row must be fetched through it before it can be deleted. */
export async function deleteDocument(
  db: OxygenDatabase,
  resource: ResolvedResource,
  id: string,
  scope?: SQL,
): Promise<Doc | undefined> {
  const existingRow = await getExistingRow(db, resource, id, scope)
  if (!existingRow) return undefined
  const doc = rowToDoc(resource.fields, existingRow)

  await runBeforeDeleteHooks(resource.hooks?.beforeDelete, doc)
  await db.delete(resource.table).where(eq(resource.columns.id!, id))
  runDocHooks(resource.hooks?.afterDelete, doc)
  return doc
}

async function getExistingRow(db: OxygenDatabase, resource: ResolvedResource, id?: string, scope?: SQL): Promise<Doc | undefined> {
  let query = db.select().from(resource.table).$dynamic()
  const idCondition = id !== undefined ? eq(resource.columns.id!, id) : undefined
  const where = idCondition && scope ? and(idCondition, scope) : (idCondition ?? scope)
  if (where) query = query.where(where)
  return (await query.get()) as Doc | undefined
}

/** See docs/SPEC.md#schema--migrations — every `oxygen()` call idempotently ensures a single's one row exists. Fixed id, not a fresh ulid() per boot, so `ON CONFLICT` actually has something to conflict on. */
export const SINGLE_ROW_ID = 'singleton'

export async function seedSingleRow(db: OxygenDatabase, resource: ResolvedResource): Promise<void> {
  const now = new Date()
  await db
    .insert(resource.table)
    .values({ id: SINGLE_ROW_ID, createdAt: now, updatedAt: now } as Doc)
    .onConflictDoNothing({ target: resource.columns.id })
}
