import { describe, expect, it } from 'vitest'
import { array } from './array.js'
import { defineCollection } from './define.js'
import { group } from './group.js'
import { boolean, number, text } from './leaf.js'
import { select } from './select.js'
import { validateDocument } from './validate.js'

describe('validateDocument', () => {
  it('flags a missing required field', async () => {
    const Posts = defineCollection({ slug: 'v-posts-1', fields: { title: text().required() } })
    const errors = await validateDocument(Posts.fields, {}, 'create')
    expect(errors).toEqual([{ field: 'title', message: 'title is required.' }])
  })

  it('passes when required fields are present', async () => {
    const Posts = defineCollection({ slug: 'v-posts-2', fields: { title: text().required() } })
    const errors = await validateDocument(Posts.fields, { title: 'hello' }, 'create')
    expect(errors).toEqual([])
  })

  it('enforces minLength/maxLength on text', async () => {
    const Posts = defineCollection({ slug: 'v-posts-3', fields: { title: text().minLength(3) } })
    const errors = await validateDocument(Posts.fields, { title: 'ab' }, 'create')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.field).toBe('title')
  })

  it('enforces static select() membership, never the label', async () => {
    const Posts = defineCollection({
      slug: 'v-posts-4',
      fields: { status: select([{ value: 'draft', label: 'Draft' }, 'published']) },
    })
    const bad = await validateDocument(Posts.fields, { status: 'Draft' }, 'create')
    expect(bad).toHaveLength(1)
    const good = await validateDocument(Posts.fields, { status: 'draft' }, 'create')
    expect(good).toEqual([])
  })

  it('does not invoke a select() loader on write', async () => {
    let called = false
    const Posts = defineCollection({
      slug: 'v-posts-5',
      fields: {
        currency: select(async () => {
          called = true
          return ['usd']
        }),
      },
    })
    const errors = await validateDocument(Posts.fields, { currency: 'anything' }, 'create')
    expect(errors).toEqual([])
    expect(called).toBe(false)
  })

  it('runs custom .validate() stack in order, short-circuiting on first failure', async () => {
    const calls: string[] = []
    const Posts = defineCollection({
      slug: 'v-posts-6',
      fields: {
        title: text()
          .validate((v) => {
            calls.push('first')
            return 'first failed'
          })
          .validate((v) => {
            calls.push('second')
            return true
          }),
      },
    })
    const errors = await validateDocument(Posts.fields, { title: 'x' }, 'create')
    expect(errors).toEqual([{ field: 'title', message: 'first failed' }])
    expect(calls).toEqual(['first'])
  })

  it('treats a field whose condition is false as absent, relaxing required and rejecting a submitted value', async () => {
    const Posts = defineCollection({
      slug: 'v-posts-7',
      fields: {
        isEvent: boolean(),
        location: text()
          .required()
          .condition((siblingData) => (siblingData as { isEvent?: boolean }).isEvent === true),
      },
    })
    const withoutEvent = await validateDocument(Posts.fields, { isEvent: false }, 'create')
    expect(withoutEvent).toEqual([])

    const submittedAnyway = await validateDocument(
      Posts.fields,
      { isEvent: false, location: 'somewhere' },
      'create',
    )
    expect(submittedAnyway).toEqual([{ field: 'location', message: 'location is not applicable.' }])
  })

  it('recurses into group() with a dot path', async () => {
    const Posts = defineCollection({
      slug: 'v-posts-8',
      fields: { hero: group({ heading: text().required() }) },
    })
    const errors = await validateDocument(Posts.fields, { hero: {} }, 'create')
    expect(errors).toEqual([{ field: 'hero.heading', message: 'hero.heading is required.' }])
  })

  it('recurses into array() items with an indexed path and enforces minRows', async () => {
    const Posts = defineCollection({
      slug: 'v-posts-9',
      fields: {
        links: array({ label: text().required() }).minRows(1),
      },
    })
    const empty = await validateDocument(Posts.fields, { links: [] }, 'create')
    expect(empty).toEqual([{ field: 'links', message: 'links must have at least 1 item(s).' }])

    const badItem = await validateDocument(Posts.fields, { links: [{}] }, 'create')
    expect(badItem).toEqual([{ field: 'links.0.label', message: 'links.0.label is required.' }])
  })

  it('validates number int/min/max', async () => {
    const Posts = defineCollection({ slug: 'v-posts-10', fields: { age: number().int().min(0).max(120) } })
    const errors = await validateDocument(Posts.fields, { age: 1.5 }, 'create')
    expect(errors).toHaveLength(1)
  })
})
