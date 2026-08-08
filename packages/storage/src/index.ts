// Phase 10 — storage interface + S3 + local adapters — see docs/BUILD_PLAN.md
export { localStorage } from './local.js'
export type { LocalStorageOptions } from './local.js'
export { s3Storage } from './s3.js'
export type { S3StorageOptions } from './s3.js'
