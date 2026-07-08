import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { db, isTurso } from './db/index.js'
import { pings } from './db/schema.js'

const app = new Hono()

app.get('/health', async (c) => {
  await db.insert(pings).values({ message: 'ping', createdAt: new Date() })
  const rows = await db.select().from(pings).all()
  return c.json({ ok: true, driver: isTurso ? 'turso' : 'local-file', rows })
})

const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`oxygen example app listening on http://localhost:${info.port}`)
})
