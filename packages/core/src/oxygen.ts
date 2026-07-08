import { Hono } from 'hono'
import type { CollectionConfig, SingleConfig } from '@deadly-studio/oxygen-fields'
import { seedSingleRow } from './crud.js'
import type { OxygenDatabase } from './database.js'
import { createCollectionRouter } from './routes/collections.js'
import { createSingleRouter } from './routes/singles.js'
import { resolveSchema } from './schema.js'
import type { ResolvedResource } from './schema.js'

export interface OxygenConfig {
  db: OxygenDatabase
  collections?: CollectionConfig[]
  singles?: SingleConfig[]
}

/**
 * `oxygen({ db, collections, singles })` — the Hono app factory + CRUD
 * generator, see docs/BUILD_PLAN.md#4-the-hono-mount-point and
 * docs/SPEC.md#generated-rest-api. No module-level singletons or caches:
 * every table, router, and seed-promise is scoped to this call's closure,
 * so nothing blocks calling `oxygen()` more than once per process later.
 */
export function oxygen(config: OxygenConfig): Hono {
  const collections = config.collections ?? []
  const singles = config.singles ?? []
  const { db } = config

  const schema = resolveSchema(collections, singles)

  const app = new Hono()

  const collectionsRouter = new Hono()
  for (const resource of schema.collections.values()) {
    collectionsRouter.route(`/${resource.slug}`, createCollectionRouter(resource, db))
  }
  app.route('/collections', collectionsRouter)

  const singlesRouter = new Hono()
  for (const resource of schema.singles.values()) {
    singlesRouter.route(`/${resource.slug}`, createSingleRouter(resource, db, ensureSingleSeeded(db, resource)))
  }
  app.route('/singles', singlesRouter)

  return app
}

/** Memoizes the seed insert per single so concurrent first requests await the same promise instead of racing separate inserts — see docs/SPEC.md#singles-seed-row. */
function ensureSingleSeeded(db: OxygenDatabase, resource: ResolvedResource): () => Promise<void> {
  let seeded: Promise<void> | undefined
  return () => {
    seeded ??= seedSingleRow(db, resource)
    return seeded
  }
}
