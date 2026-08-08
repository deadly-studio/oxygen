import { and, eq, lte } from 'drizzle-orm'
import type { AfterChangeHook, DocHook, HookContext } from '@deadly-studio/oxygen-fields'
import type { OxygenDatabase } from './database.js'
import { ulid } from './ulid.js'
import { webhookDeliveries } from './webhook-tables.js'

export interface WebhookOptions {
  url: string
  secret: string
  /** Override for testing or a non-global-fetch environment; defaults to global `fetch`. */
  fetch?: typeof fetch
}

export type WebhookEvent = 'afterChange' | 'afterDelete'

export interface WebhookPayload {
  event: WebhookEvent
  collection: string
  doc: unknown
  previousDoc?: unknown
}

/** 1m, 5m, 15m, 1h, 6h, then give up — see docs/SPEC.md#webhooks. */
export const WEBHOOK_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000]

async function signPayload(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256=${hex}`
}

async function attemptDelivery(fetchImpl: typeof fetch, url: string, body: string, signature: string): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Oxygen-Signature': signature },
      body,
    })
    return response.ok
  } catch {
    return false
  }
}

const WEBHOOK_MARKER = Symbol('oxygen.webhook')

interface Marked {
  [WEBHOOK_MARKER]?: WebhookOptions
}

/** @internal Read by `wireResourceWebhooks` — not part of the public API. */
export function getWebhookOptions(fn: unknown): WebhookOptions | undefined {
  return typeof fn === 'function' ? (fn as Marked)[WEBHOOK_MARKER] : undefined
}

/**
 * A `hooks.afterChange`/`hooks.afterDelete` helper — see
 * docs/SPEC.md#webhooks. Registered directly in `defineCollection`/
 * `defineSingle`'s config, which happens before `db` (or even the
 * collection's own slug, from this function's point of view) exists — so
 * the value this returns only marks itself for delivery. `oxygen()`
 * recognizes that marker (`getWebhookOptions`) and substitutes a version
 * bound to `db` and the real event/collection name — see
 * `wireResourceWebhooks` below — which is what actually runs in the request
 * pipeline and persists failures for retry.
 *
 * Called directly without going through `oxygen()` (e.g. in isolation), the
 * marked function still attempts one best-effort delivery — it just can't
 * persist a failure to `cms_webhook_deliveries` without a db, and reports
 * `collection: '(unknown)'` since it has no way to know its own slug.
 */
export function webhook<TDoc = unknown>(options: WebhookOptions): AfterChangeHook<TDoc> & DocHook<TDoc> {
  const fn = ((doc: TDoc, ctx?: HookContext<TDoc>) => {
    const fetchImpl = options.fetch ?? globalThis.fetch
    const payload: WebhookPayload = { event: 'afterChange', collection: '(unknown)', doc, previousDoc: ctx?.previousDoc }
    const body = JSON.stringify(payload)
    void signPayload(options.secret, body).then((signature) => attemptDelivery(fetchImpl, options.url, body, signature))
  }) as AfterChangeHook<TDoc> & DocHook<TDoc> & Marked
  fn[WEBHOOK_MARKER] = options
  return fn
}

/**
 * Replaces every marked `webhook()` entry in `hooks.afterChange`/
 * `hooks.afterDelete` with a version closed over `db` and this resource's
 * slug/event — called once per resource inside `oxygen()`, see oxygen.ts.
 * Mutates the arrays in place; non-webhook hooks are left untouched.
 */
export function wireResourceWebhooks(
  hooks: { afterChange?: unknown[]; afterDelete?: unknown[] } | undefined,
  db: OxygenDatabase,
  collection: string,
): void {
  wireEvent(hooks?.afterChange, db, collection, 'afterChange')
  wireEvent(hooks?.afterDelete, db, collection, 'afterDelete')
}

function wireEvent(list: unknown[] | undefined, db: OxygenDatabase, collection: string, event: WebhookEvent): void {
  if (!list) return
  for (let i = 0; i < list.length; i++) {
    const options = getWebhookOptions(list[i])
    if (!options) continue
    list[i] = createWiredHook(db, collection, event, options)
  }
}

function createWiredHook(db: OxygenDatabase, collection: string, event: WebhookEvent, options: WebhookOptions) {
  return async (doc: unknown, ctx?: HookContext<unknown>): Promise<void> => {
    const payload: WebhookPayload = { event, collection, doc, previousDoc: ctx?.previousDoc }
    const body = JSON.stringify(payload)
    const signature = await signPayload(options.secret, body)
    const fetchImpl = options.fetch ?? globalThis.fetch
    const ok = await attemptDelivery(fetchImpl, options.url, body, signature)
    if (ok) return

    const now = new Date()
    await db.insert(webhookDeliveries).values({
      id: ulid(),
      event,
      collection,
      url: options.url,
      payload: body,
      signature,
      status: 'pending',
      attempts: 1,
      nextAttemptAt: new Date(now.getTime() + WEBHOOK_BACKOFF_MS[0]!),
      lastError: 'Delivery failed (non-2xx response or network error).',
      createdAt: now,
    })
  }
}

export interface ProcessWebhookDeliveriesOptions {
  fetch?: typeof fetch
  now?: Date
}

export interface ProcessWebhookDeliveriesResult {
  processed: number
  delivered: number
  failed: number
  stillPending: number
}

/**
 * Retries every due (`status: 'pending'`, `nextAttemptAt <= now`) delivery,
 * advancing `WEBHOOK_BACKOFF_MS` or giving up (`status: 'failed'`) once it's
 * exhausted — see docs/SPEC.md#webhooks. oxygen has no background worker of
 * its own (it's a library mounted into a consumer's Hono app, not a
 * standalone process), so this is a plain function a consumer wires into
 * their own cron/scheduled task rather than something `oxygen()` runs on a
 * timer itself.
 */
export async function processWebhookDeliveries(
  db: OxygenDatabase,
  options: ProcessWebhookDeliveriesOptions = {},
): Promise<ProcessWebhookDeliveriesResult> {
  const now = options.now ?? new Date()
  const fetchImpl = options.fetch ?? globalThis.fetch

  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, now)))
    .all()

  let delivered = 0
  let failed = 0
  for (const row of due) {
    const ok = await attemptDelivery(fetchImpl, row.url, row.payload, row.signature)
    if (ok) {
      await db.update(webhookDeliveries).set({ status: 'delivered' }).where(eq(webhookDeliveries.id, row.id))
      delivered++
      continue
    }

    const attempts = row.attempts + 1
    if (attempts > WEBHOOK_BACKOFF_MS.length) {
      await db
        .update(webhookDeliveries)
        .set({ status: 'failed', attempts, lastError: 'Exhausted retry schedule.' })
        .where(eq(webhookDeliveries.id, row.id))
      failed++
    } else {
      await db
        .update(webhookDeliveries)
        .set({
          attempts,
          nextAttemptAt: new Date(now.getTime() + WEBHOOK_BACKOFF_MS[attempts - 1]!),
          lastError: 'Delivery failed (non-2xx response or network error).',
        })
        .where(eq(webhookDeliveries.id, row.id))
    }
  }

  return { processed: due.length, delivered, failed, stillPending: due.length - delivered - failed }
}
