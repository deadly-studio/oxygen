import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { buildWhere, parsePagination, parseSort, parseWhereParam, QueryError } from './where.js'

const table = sqliteTable('t', {
  id: text('id').primaryKey(),
  title: text('title'),
  views: integer('views'),
})
const columns = { id: table.id, title: table.title, views: table.views }

describe('parseWhereParam', () => {
  it('returns undefined for an absent param', () => {
    expect(parseWhereParam(undefined)).toBeUndefined()
  })

  it('rejects invalid JSON', () => {
    expect(() => parseWhereParam('{not json')).toThrow(QueryError)
  })
})

describe('buildWhere', () => {
  it('returns undefined for an absent filter', () => {
    expect(buildWhere(columns, undefined)).toBeUndefined()
  })

  it('rejects a non-object filter', () => {
    expect(() => buildWhere(columns, 'nope')).toThrow(QueryError)
  })

  it('rejects an unknown field', () => {
    expect(() => buildWhere(columns, { nope: 1 })).toThrow(/Unknown filter field/)
  })

  it('rejects an unsupported operator', () => {
    expect(() => buildWhere(columns, { views: { $bogus: 1 } })).toThrow(/Unsupported filter operator/)
  })

  it('rejects a non-array $and/$or', () => {
    expect(() => buildWhere(columns, { $and: { title: 'x' } })).toThrow(/must be an array/)
  })

  it('builds shorthand equality, operator objects, and nested $and/$or without throwing', () => {
    expect(() => buildWhere(columns, { title: 'hello' })).not.toThrow()
    expect(() => buildWhere(columns, { views: { $gte: 10, $lte: 20 } })).not.toThrow()
    expect(() =>
      buildWhere(columns, { $or: [{ title: 'a' }, { $and: [{ views: { $gt: 1 } }, { views: { $lt: 9 } }] }] }),
    ).not.toThrow()
  })
})

describe('parseSort', () => {
  it('returns an empty array for an absent param', () => {
    expect(parseSort(columns, undefined)).toEqual([])
  })

  it('parses ascending, descending, and multiple comma-separated fields', () => {
    const sort = parseSort(columns, '-views,title')
    expect(sort).toEqual([
      { column: columns.views, direction: 'desc' },
      { column: columns.title, direction: 'asc' },
    ])
  })

  it('rejects an unknown sort field', () => {
    expect(() => parseSort(columns, 'nope')).toThrow(/Unknown sort field/)
  })
})

describe('parsePagination', () => {
  it('defaults to limit 10, page 1', () => {
    expect(parsePagination(undefined, undefined)).toEqual({ limit: 10, page: 1 })
  })

  it('caps limit at 100', () => {
    expect(parsePagination('500', undefined)).toEqual({ limit: 100, page: 1 })
  })

  it('rejects a non-positive-integer limit or page', () => {
    expect(() => parsePagination('0', undefined)).toThrow(QueryError)
    expect(() => parsePagination('1.5', undefined)).toThrow(QueryError)
    expect(() => parsePagination(undefined, '-1')).toThrow(QueryError)
  })
})
