import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import type { EmailAdapter, EmailMessage } from '@deadly-studio/oxygen-email'
import { cmsAuthTables } from './tables.js'

export function fakeEmail(): EmailAdapter & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = []
  return {
    sent,
    async send(message) {
      sent.push(message)
    },
  }
}

export function codeFrom(message: EmailMessage): string {
  return /Your code is (\d{6})/.exec(message.text ?? '')![1]!
}

/** Turns a `Set-Cookie` response header into the `Cookie` header value for the next request. */
export function cookieHeaderFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')!
  return setCookie.split(';')[0]!
}

export async function readJson(res: Response): Promise<any> {
  return res.json()
}

export function postJson(body: unknown, extraHeaders: Record<string, string> = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  }
}

/**
 * `otpAuth`'s bootstrap transaction is the first thing in this codebase to
 * call `db.transaction()`. @libsql/client's local sqlite3 adapter hands the
 * current connection to the transaction and lazily opens a *new* one for the
 * next non-tx query (see its `sqlite3.js`) — for a real file this is
 * invisible (every connection sees the same on-disk data), but a bare
 * `:memory:` URL gives every connection its own separate, empty database, so
 * the very next query after a transaction would find all the tables gone.
 * A real (temp) file sidesteps that entirely and is closer to how oxygen
 * actually gets used.
 */
export async function createTestDb(extraTables: Record<string, AnySQLiteTable> = {}) {
  const dbPath = join(tmpdir(), `oxygen-auth-test-${crypto.randomUUID()}.db`)
  const client = createClient({ url: `file:${dbPath}` })
  await client.execute('PRAGMA foreign_keys = ON;')
  const db: LibSQLDatabase = drizzle(client)

  const tables = { ...cmsAuthTables, ...extraTables }
  const { apply } = await pushSQLiteSchema(tables, db)
  await apply()

  const cleanup = async () => {
    await Promise.all([dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((p) => rm(p, { force: true })))
  }
  return { db, cleanup }
}
