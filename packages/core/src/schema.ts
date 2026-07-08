import { getTableColumns } from 'drizzle-orm'
import type { AnySQLiteColumn, AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { buildSchema } from '@deadly-studio/oxygen-fields'
import type { CollectionConfig, FieldDescriptor, Hooks, SingleConfig } from '@deadly-studio/oxygen-fields'

export interface ResolvedResource {
  slug: string
  type: 'collection' | 'single'
  fields: Record<string, FieldDescriptor>
  hooks?: Hooks<Record<string, unknown>>
  table: AnySQLiteTable
  columns: Record<string, AnySQLiteColumn>
}

export interface ResolvedSchema {
  collections: Map<string, ResolvedResource>
  singles: Map<string, ResolvedResource>
}

/**
 * Builds every collection/single's Drizzle table in one pass (so relation()
 * FKs can target each other regardless of declaration order, see
 * docs/FIELDS.md#translation-layer-contract) and indexes the result by slug
 * for the CRUD generator and query DSL to look up at request time.
 */
export function resolveSchema(
  collections: CollectionConfig[],
  singles: SingleConfig[],
): ResolvedSchema {
  const seenSlugs = new Map<string, 'collection' | 'single'>()
  for (const { slug, type } of [...collections, ...singles]) {
    const existing = seenSlugs.get(slug)
    if (existing) {
      throw new Error(`oxygen: slug '${slug}' is used by both a collection and a single — slugs must be unique.`)
    }
    seenSlugs.set(slug, type)
  }

  const tables = buildSchema([
    ...collections.map((c) => ({ slug: c.slug, fields: c.fields })),
    ...singles.map((s) => ({ slug: s.slug, fields: s.fields })),
  ])

  const resolvedCollections = new Map<string, ResolvedResource>()
  for (const config of collections) {
    resolvedCollections.set(config.slug, resolve(config, tables[config.slug]!))
  }
  const resolvedSingles = new Map<string, ResolvedResource>()
  for (const config of singles) {
    resolvedSingles.set(config.slug, resolve(config, tables[config.slug]!))
  }
  return { collections: resolvedCollections, singles: resolvedSingles }
}

function resolve(config: CollectionConfig | SingleConfig, table: AnySQLiteTable): ResolvedResource {
  return {
    slug: config.slug,
    type: config.type,
    fields: config.fields,
    hooks: config.hooks as Hooks<Record<string, unknown>> | undefined,
    table,
    columns: getTableColumns(table),
  }
}
