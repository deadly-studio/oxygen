import { describe, expect, it } from 'vitest'
import { ulid } from './ulid.js'

describe('ulid', () => {
  it('is 26 characters of Crockford base32', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('sorts lexicographically by creation time', () => {
    const earlier = ulid(1000)
    const later = ulid(2000)
    expect(earlier < later).toBe(true)
  })

  it('is unique across calls at the same millisecond', () => {
    const now = Date.now()
    const ids = new Set(Array.from({ length: 50 }, () => ulid(now)))
    expect(ids.size).toBe(50)
  })
})
