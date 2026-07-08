import { defineCollection, group, relation, text, timestamp, upload } from '@deadly-studio/oxygen-fields'
import { describe, expect, it } from 'vitest'
import { coerceDoc, docToRow, rowToDoc } from './document.js'

const Posts = defineCollection({
  slug: 'posts',
  fields: {
    title: text().required(),
    publishedAt: timestamp(),
    hero: group({ heading: text() }),
    cover: upload(),
    author: relation('users'),
  },
})

describe('coerceDoc', () => {
  it('converts a wire-format date string to a Date, recursing into group()', () => {
    const doc = coerceDoc(Posts.fields, { publishedAt: '2024-01-01T00:00:00.000Z', hero: { heading: 'hi' } })
    expect(doc.publishedAt).toBeInstanceOf(Date)
    expect(doc.hero).toEqual({ heading: 'hi' })
  })

  it('leaves keys absent from the input absent from the output, distinguishing "untouched" from "cleared"', () => {
    const doc = coerceDoc(Posts.fields, { title: 'hi' })
    expect(doc).toEqual({ title: 'hi' })
    expect('publishedAt' in doc).toBe(false)
  })
})

describe('docToRow / rowToDoc', () => {
  it('round-trips a group() through its flattened, prefixed columns', () => {
    const row = docToRow(Posts.fields, { title: 't', hero: { heading: 'h' } })
    expect(row).toMatchObject({ title: 't', hero_heading: 'h' })
    const doc = rowToDoc(Posts.fields, row)
    expect(doc.hero).toEqual({ heading: 'h' })
  })

  it("round-trips upload()'s 4 flattened columns, and reports absence as null", () => {
    const withUpload = docToRow(Posts.fields, {
      cover: { key: 'k', filename: 'f.png', mimeType: 'image/png', filesize: 10 },
    })
    expect(withUpload).toMatchObject({ cover_key: 'k', cover_filename: 'f.png', cover_mimeType: 'image/png', cover_filesize: 10 })
    expect(rowToDoc(Posts.fields, withUpload).cover).toEqual({ key: 'k', filename: 'f.png', mimeType: 'image/png', filesize: 10 })

    const withoutUpload = docToRow(Posts.fields, { cover: null })
    expect(withoutUpload.cover_key).toBeNull()
    expect(rowToDoc(Posts.fields, withoutUpload).cover).toBeNull()
  })

  it('omits a key entirely from the row when absent from the doc, instead of writing null', () => {
    const row = docToRow(Posts.fields, { title: 't' })
    expect('author' in row).toBe(false)
    expect('publishedAt' in row).toBe(false)
  })

  it('reports a leaf column missing from the row as null', () => {
    expect(rowToDoc(Posts.fields, { title: 't' }).author).toBeNull()
  })
})
