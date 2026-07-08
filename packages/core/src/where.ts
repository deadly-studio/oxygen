import { and, eq, gt, gte, inArray, isNotNull, isNull, like, lt, lte, ne, notInArray, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

/** A malformed `?where=`/`?sort=`/pagination param — the route layer maps this to a 400. */
export class QueryError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildCondition(column: AnySQLiteColumn, operator: string, value: unknown): SQL {
  switch (operator) {
    case '$eq':
      return eq(column, value)
    case '$ne':
      return ne(column, value)
    case '$gt':
      return gt(column, value)
    case '$gte':
      return gte(column, value)
    case '$lt':
      return lt(column, value)
    case '$lte':
      return lte(column, value)
    case '$in':
      return inArray(column, value as unknown[])
    case '$nin':
      return notInArray(column, value as unknown[])
    case '$like':
      return like(column, value as string)
    case '$exists':
      return value ? isNotNull(column) : isNull(column)
    default:
      throw new QueryError(`Unsupported filter operator '${operator}'.`)
  }
}

/**
 * Lowers the `?where=`/`cms_permissions.scope` filter grammar
 * (docs/SPEC.md#query-dsl-list-endpoint) to a drizzle `SQL` condition.
 * `columns` is the resource's full column map, so a filter can only ever
 * reach columns that actually exist on that table.
 */
export function buildWhere(columns: Record<string, AnySQLiteColumn>, filter: unknown): SQL | undefined {
  if (filter === undefined || filter === null) return undefined
  if (!isPlainObject(filter)) throw new QueryError('where must be a JSON object.')

  const clauses: SQL[] = []
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) throw new QueryError(`${key} must be an array of filters.`)
      const sub = value.map((v) => buildWhere(columns, v)).filter((s): s is SQL => s !== undefined)
      if (sub.length === 0) continue
      const combined = key === '$and' ? and(...sub) : or(...sub)
      if (combined) clauses.push(combined)
      continue
    }

    const column = columns[key]
    if (!column) throw new QueryError(`Unknown filter field '${key}'.`)

    if (isPlainObject(value)) {
      for (const [operator, operand] of Object.entries(value)) {
        clauses.push(buildCondition(column, operator, operand))
      }
    } else {
      clauses.push(eq(column, value))
    }
  }

  if (clauses.length === 0) return undefined
  return clauses.length === 1 ? clauses[0] : and(...clauses)
}

/** Parses the raw `?where=<json>` string, surfacing bad JSON as a `QueryError` like any other malformed query param. */
export function parseWhereParam(raw: string | undefined): unknown {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new QueryError('where must be valid JSON.')
  }
}

export interface SortSpec {
  column: AnySQLiteColumn
  direction: 'asc' | 'desc'
}

/** `?sort=field` ascending, `?sort=-field` descending, comma-separated for multiple. */
export function parseSort(columns: Record<string, AnySQLiteColumn>, raw: string | undefined): SortSpec[] {
  if (!raw) return []
  return raw.split(',').map((segment) => {
    const descending = segment.startsWith('-')
    const key = descending ? segment.slice(1) : segment
    const column = columns[key]
    if (!column) throw new QueryError(`Unknown sort field '${key}'.`)
    return { column, direction: descending ? 'desc' : 'asc' }
  })
}

export interface Pagination {
  limit: number
  page: number
}

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100

/** `?limit=` (default 10, max 100) and `?page=` (default 1) — offset pagination. */
export function parsePagination(limitRaw: string | undefined, pageRaw: string | undefined): Pagination {
  const limit = limitRaw !== undefined ? Number(limitRaw) : DEFAULT_LIMIT
  const page = pageRaw !== undefined ? Number(pageRaw) : 1
  if (!Number.isInteger(limit) || limit < 1) throw new QueryError('limit must be a positive integer.')
  if (!Number.isInteger(page) || page < 1) throw new QueryError('page must be a positive integer.')
  return { limit: Math.min(limit, MAX_LIMIT), page }
}
