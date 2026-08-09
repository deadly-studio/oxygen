import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { tables } from './schema.js'

// Falls back to a local SQLite file when Turso credentials aren't set, so
// `pnpm dev` works with zero setup — swap in TURSO_DATABASE_URL/TURSO_AUTH_TOKEN
// to prove the same code runs unmodified against Turso.
const url = process.env.TURSO_DATABASE_URL ?? 'file:local.db'
const authToken = process.env.TURSO_AUTH_TOKEN

const client = createClient(authToken ? { url, authToken } : { url })

export const db = drizzle(client)
export const isTurso = Boolean(process.env.TURSO_DATABASE_URL)

/** Diffs `tables` against the live database and applies — see docs/GUIDE.md#migrations. */
export async function ensureSchema(): Promise<void> {
  const { apply } = await pushSQLiteSchema(tables, db)
  await apply()
}
