import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { cmsAuthTables } from '@deadly-studio/oxygen-auth'
import type { EmailAdapter, EmailMessage } from '@deadly-studio/oxygen-email'
import { permissionsTables } from './tables.js'

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

/** A real temp file, not `:memory:` — see @deadly-studio/oxygen-auth's test-helpers.ts for why (its bootstrap transaction breaks a bare `:memory:` connection). */
export async function createTestDb(extraTables: Record<string, AnySQLiteTable> = {}) {
  const dbPath = join(tmpdir(), `oxygen-permissions-test-${crypto.randomUUID()}.db`)
  const client = createClient({ url: `file:${dbPath}` })
  await client.execute('PRAGMA foreign_keys = ON;')
  const db: LibSQLDatabase = drizzle(client)

  const tables = { ...cmsAuthTables, ...permissionsTables, ...extraTables }
  const { apply } = await pushSQLiteSchema(tables, db)
  await apply()

  const cleanup = async () => {
    await Promise.all([dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((p) => rm(p, { force: true })))
  }
  return { db, cleanup }
}
