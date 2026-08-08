import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { S3ClientConfig } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { StorageAdapter } from '@deadly-studio/oxygen'

export interface S3StorageOptions {
  bucket: string
  region: string
  /** Override for an S3-compatible service (e.g. Cloudflare R2) — see docs/BUILD_PLAN.md#9-storage. */
  endpoint?: string
  /** Most S3-compatible services (R2 included) need path-style addressing; real AWS S3 doesn't. */
  forcePathStyle?: boolean
  credentials?: S3ClientConfig['credentials']
  /** How long a presigned URL stays valid, in seconds. Defaults to 15 minutes. */
  expiresInSeconds?: number
  /** Inject an existing client instead of letting this adapter construct one — mainly for tests. */
  client?: S3Client
}

const DEFAULT_EXPIRES_IN_SECONDS = 15 * 60

/**
 * S3 (or S3-compatible, e.g. R2) storage adapter — see docs/SPEC.md#storage.
 * Presigned URLs mean uploads/downloads bypass oxygen entirely once issued
 * (docs/SPEC.md's upload flow step 2); this adapter never has `mount()` —
 * there's no route for oxygen to serve, the bucket does that directly.
 */
export function s3Storage(options: S3StorageOptions): StorageAdapter {
  const client =
    options.client ??
    new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: options.credentials,
    })
  const expiresIn = options.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS

  return {
    async getUploadUrl(key, contentType) {
      const command = new PutObjectCommand({ Bucket: options.bucket, Key: key, ContentType: contentType })
      const url = await getSignedUrl(client, command, { expiresIn })
      return { url }
    },

    async getDownloadUrl(key) {
      const command = new GetObjectCommand({ Bucket: options.bucket, Key: key })
      return getSignedUrl(client, command, { expiresIn })
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }))
    },
  }
}
