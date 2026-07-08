import { Hono } from 'hono'
import type { Context } from 'hono'
import type { SelectDescriptor, SelectOption } from '@deadly-studio/oxygen-fields'
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  updateDocument,
  ValidationFailure,
} from '../crud.js'
import type { OxygenDatabase } from '../database.js'
import { errorResponse, isForeignKeyConstraintError, isUniqueConstraintError, notFound } from '../errors.js'
import type { ResolvedResource } from '../schema.js'
import { buildWhere, parsePagination, parseSort, parseWhereParam, QueryError } from '../where.js'

async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json()
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function normalizeOption(option: SelectOption): { value: string; label: string } {
  return typeof option === 'string' ? { value: option, label: option } : option
}

/** Generated CRUD routes for one collection — see docs/SPEC.md#generated-rest-api. Paths are relative to the `/collections/:slug` mount point. */
export function createCollectionRouter(resource: ResolvedResource, db: OxygenDatabase): Hono {
  const app = new Hono()

  // Registered ahead of `/:id` — `fields` is a literal path segment so it
  // can't collide with an id lookup, but keeping the more specific route
  // first avoids relying on router internals to disambiguate them.
  app.get('/fields/:field/options', async (c) => {
    const fieldKey = c.req.param('field')
    const descriptor = resource.fields[fieldKey]
    if (!descriptor || descriptor.kind !== 'select') {
      return notFound(c, `'${fieldKey}' is not a select() field on '${resource.slug}'.`)
    }
    const d = descriptor as SelectDescriptor
    const search = c.req.query('search')
    const limitParam = c.req.query('limit')
    const limit = limitParam !== undefined ? Number(limitParam) : undefined

    let options: SelectOption[]
    if (typeof d.options === 'function') {
      options = await d.options({ search, limit })
    } else {
      options = d.options
      if (search) {
        const needle = search.toLowerCase()
        options = options.filter((o) => normalizeOption(o).label.toLowerCase().includes(needle))
      }
      if (limit !== undefined) options = options.slice(0, limit)
    }
    return c.json({ options: options.map(normalizeOption) })
  })

  app.get('/', async (c) => {
    try {
      const where = buildWhere(resource.columns, parseWhereParam(c.req.query('where')))
      const sort = parseSort(resource.columns, c.req.query('sort'))
      const { limit, page } = parsePagination(c.req.query('limit'), c.req.query('page'))
      const result = await listDocuments(db, resource, { where, sort, limit, page })
      return c.json(result)
    } catch (error) {
      if (error instanceof QueryError) return errorResponse(c, 400, [{ message: error.message }])
      throw error
    }
  })

  app.get('/:id', async (c) => {
    const doc = await getDocument(db, resource, c.req.param('id'))
    if (!doc) return notFound(c)
    return c.json(doc)
  })

  app.post('/', async (c) => {
    const body = await readJsonBody(c)
    if (!body) return errorResponse(c, 400, [{ message: 'Request body must be a JSON object.' }])
    try {
      const doc = await createDocument(db, resource, body)
      return c.json({ message: `${resource.slug} created.`, doc }, 201)
    } catch (error) {
      return handleWriteError(c, error)
    }
  })

  app.patch('/:id', async (c) => {
    const body = await readJsonBody(c)
    if (!body) return errorResponse(c, 400, [{ message: 'Request body must be a JSON object.' }])
    try {
      const doc = await updateDocument(db, resource, body, c.req.param('id'))
      if (!doc) return notFound(c)
      return c.json({ message: `${resource.slug} updated.`, doc })
    } catch (error) {
      return handleWriteError(c, error)
    }
  })

  app.delete('/:id', async (c) => {
    const doc = await deleteDocument(db, resource, c.req.param('id'))
    if (!doc) return notFound(c)
    return c.json({ message: `${resource.slug} deleted.` })
  })

  return app
}

function handleWriteError(c: Context, error: unknown): Response {
  if (error instanceof ValidationFailure) return errorResponse(c, 400, error.errors)
  if (isUniqueConstraintError(error)) {
    return errorResponse(c, 409, [{ message: 'A document with this value already exists.' }])
  }
  if (isForeignKeyConstraintError(error)) {
    return errorResponse(c, 409, [{ message: 'This document is referenced by, or references, another document.' }])
  }
  throw error
}
