import { serve } from '@hono/node-server'
import { app, PORT } from './app.js'
import { ensureSchema } from './db/index.js'

await ensureSchema()

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`oxygen example app listening on http://localhost:${info.port}`)
  console.log(`Try: curl -X POST http://localhost:${info.port}/cms/auth/otp/request -H 'content-type: application/json' -d '{"email":"you@example.com"}'`)
})
