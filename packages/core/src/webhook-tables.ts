import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * See docs/SPEC.md#webhooks. `signature` isn't in the spec's literal column
 * list — added so a retry can resend the exact original payload bytes with
 * its original `X-Oxygen-Signature` without needing to hold the delivery's
 * secret in this queue table at all; the secret only ever exists transiently
 * inside `webhook()`'s closure at the moment of the original attempt.
 */
export const webhookDeliveries = sqliteTable('cms_webhook_deliveries', {
  id: text('id').primaryKey(),
  event: text('event').notNull(),
  collection: text('collection').notNull(),
  url: text('url').notNull(),
  payload: text('payload').notNull(),
  signature: text('signature').notNull(),
  /** 'pending' | 'delivered' | 'failed' */
  status: text('status').notNull(),
  attempts: integer('attempts').notNull(),
  nextAttemptAt: integer('nextAttemptAt', { mode: 'timestamp' }).notNull(),
  lastError: text('lastError'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
})

/** For pushing/generating physical schema alongside a consumer's own collections until docs/SPEC.md#schema--migrations' `oxygen generate` CLI exists. */
export const webhookTables = { webhookDeliveries }
