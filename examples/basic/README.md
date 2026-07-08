# examples/basic

Throwaway app validating that oxygen's storage layer is driver-agnostic: a Hono
server backed by Drizzle's SQLite dialect over `@libsql/client`, defaulting to
a local file (`./local.db`) with zero setup, and switching to Turso unmodified
once `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` are set.

```bash
pnpm --filter oxygen-example-basic dev
curl http://localhost:3000/health
```

Copy `.env.example` to `.env` and fill in Turso credentials to run the same
code against a real Turso database instead of the local file.
