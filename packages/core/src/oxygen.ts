import { Hono } from 'hono'
import type { CollectionConfig, SingleConfig } from '@deadly-studio/oxygen-fields'
import type { AppAuthStrategy, CmsAuthStrategy } from './auth.js'
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
  auth?: { cms?: CmsAuthStrategy; app?: AppAuthStrategy }
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

  const cmsAuth = config.auth?.cms
  if (cmsAuth) {
    // Registered ahead of the collections/singles routers so it wraps them — see docs/SPEC.md#auth.
    app.use('/collections/*', cmsAuth.middleware(db))
    app.use('/singles/*', cmsAuth.middleware(db))
    app.route('/auth', cmsAuth.createRouter(db))
  }

  const appAuth = config.auth?.app
  for (const collectionConfig of collections) {
    if (!collectionConfig.auth) continue
    if (!appAuth) {
      throw new Error(
        `oxygen: collection '${collectionConfig.slug}' is auth-enabled (auth: true) but no auth.app strategy was configured.`,
      )
    }
    // Own login namespace per collection — see docs/SPEC.md#app-user-auth-otp--jwt.
    app.route(`/app/${collectionConfig.slug}/auth`, appAuth.createRouter(db, schema.collections.get(collectionConfig.slug)!))
  }

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
