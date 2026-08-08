import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { s3Storage } from './s3.js'
import type { S3StorageOptions } from './s3.js'

const s3Mock = mockClient(S3Client)

function adapter(overrides: Partial<S3StorageOptions> = {}) {
  return s3Storage({
    bucket: 'my-bucket',
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIAFAKE', secretAccessKey: 'fakefakefakefakefakefakefakefakefake' },
    ...overrides,
  })
}

describe('s3Storage', () => {
  beforeEach(() => {
    s3Mock.reset()
  })

  it('getUploadUrl() returns a presigned PUT URL scoped to the bucket+key', async () => {
    const { url } = await adapter().getUploadUrl('posts/photo/abc-photo.png', 'image/png')
    const parsed = new URL(url)
    expect(parsed.hostname).toContain('my-bucket')
    expect(parsed.pathname).toContain('posts/photo/abc-photo.png')
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy()
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe(String(15 * 60))
  })

  it('getDownloadUrl() returns a presigned GET URL', async () => {
    const url = await adapter().getDownloadUrl('posts/photo/abc-photo.png')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy()
    expect(parsed.pathname).toContain('posts/photo/abc-photo.png')
  })

  it('respects a custom expiresInSeconds', async () => {
    const { url } = await adapter({ expiresInSeconds: 60 }).getUploadUrl('k', 'text/plain')
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('60')
  })

  it('delete() sends a DeleteObjectCommand for the bucket+key', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({})
    await adapter().delete('posts/photo/abc-photo.png')
    expect(s3Mock.calls()).toHaveLength(1)
    expect(s3Mock.call(0).args[0].input).toEqual({ Bucket: 'my-bucket', Key: 'posts/photo/abc-photo.png' })
  })

  it('supports an R2-style custom endpoint + forcePathStyle', async () => {
    const { url } = await adapter({
      endpoint: 'https://xyz.r2.cloudflarestorage.com',
      forcePathStyle: true,
    }).getUploadUrl('k', 'text/plain')
    expect(new URL(url).hostname).toBe('xyz.r2.cloudflarestorage.com')
  })
})
