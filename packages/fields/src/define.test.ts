import { describe, expect, it } from 'vitest'
import { array } from './array.js'
import { defineCollection, defineFields, defineSingle } from './define.js'
import { group } from './group.js'
import { text } from './leaf.js'
import { relation } from './relation.js'

describe('defineCollection', () => {
  it('rejects an invalid slug', () => {
    expect(() => defineCollection({ slug: 'Posts', fields: {} })).toThrow(/slug/)
  })

  it('rejects a field named id/createdAt/updatedAt', () => {
    expect(() => defineCollection({ slug: 'posts-1', fields: { id: text() } })).toThrow(/reserved/)
    expect(() => defineCollection({ slug: 'posts-2', fields: { createdAt: text() } })).toThrow(/reserved/)
  })

  it("rejects two fields flattening to the same column, naming both", () => {
    expect(() =>
      defineCollection({
        slug: 'posts-3',
        fields: {
          hero: group({ heading: text() }),
          hero_heading: text(),
        },
      }),
    ).toThrow(/hero\.heading.*hero_heading|hero_heading.*hero\.heading/)
  })

  it('rejects a required relation with onDelete(setNull)', () => {
    expect(() =>
      defineCollection({
        slug: 'posts-4',
        fields: { author: relation('users').required().onDelete('setNull') },
      }),
    ).toThrow(/setNull/)
  })

  it('accepts a valid config and returns sealed field descriptors', () => {
    const Posts = defineCollection({
      slug: 'posts-5',
      fields: { title: text().required() },
    })
    expect(Posts.fields.title).toMatchObject({ kind: 'text', required: true })
    expect(Posts.auth).toBe(false)
  })

  it('defaults auth to false and accepts auth: true', () => {
    const Customers = defineCollection({ slug: 'customers', fields: {}, auth: true })
    expect(Customers.auth).toBe(true)
  })
})

describe('defineSingle', () => {
  it('has no auth field and same collision rules as defineCollection', () => {
    const Settings = defineSingle({ slug: 'site-settings', fields: { supportEmail: text().required() } })
    expect(Settings.type).toBe('single')
    expect(Settings.fields.supportEmail).toMatchObject({ required: true })
  })
})

describe('defineFields', () => {
  it('produces fresh builder instances per call', () => {
    const seoFields = defineFields(() => ({ title: text() }))
    const a = seoFields()
    const b = seoFields()
    expect(a.title).not.toBe(b.title)

    defineCollection({ slug: 'reuse-a', fields: { seo: group(a) } })
    // b's title is untouched by a's collection consuming a's copy
    expect(() => b.title.required()).not.toThrow()
  })
})
