import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

/**
 * The one thing oxygen requires of `db` (see docs/BUILD_PLAN.md#3-database-driver):
 * any drizzle SQLite client, sync (better-sqlite3) or async (libsql/Turso,
 * D1, bun:sqlite). Every query in this package is written with a plain
 * `await`, which resolves immediately for a sync driver's non-Promise
 * return value just as it does for an async driver's Promise — so the same
 * code path works unmodified against either.
 */
export type OxygenDatabase = BaseSQLiteDatabase<'sync' | 'async', unknown, Record<string, unknown>>
