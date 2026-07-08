import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'

export const pings = sqliteTable('pings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  message: text('message').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})
