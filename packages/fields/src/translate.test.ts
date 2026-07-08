import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { defineCollection } from './define.js'
import { group } from './group.js'
import { number, text } from './leaf.js'
import { relation } from './relation.js'
import { select } from './select.js'
import { buildSchema } from './translate.js'

describe('buildSchema', () => {
  it('builds a table with implicit id/createdAt/updatedAt plus translated columns', () => {
    const Posts = defineCollection({
      slug: 'posts',
      fields: {
        title: text().required(),
        views: number().int(),
        hero: group({ heading: text() }),
      },
    })
    const tables = buildSchema([Posts])
    const columns = getTableColumns(tables.posts!)
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining(['id', 'createdAt', 'updatedAt', 'title', 'views', 'hero_heading']),
    )
  })

  it('wires relation() as a real FK against the target table, resolved lazily', () => {
    const Users = defineCollection({ slug: 'users', fields: { name: text() } })
    const Posts = defineCollection({ slug: 'posts-rel', fields: { author: relation('users').required() } })
    const tables = buildSchema([Users, Posts])
    const columns = getTableColumns(tables['posts-rel']!)
    expect(columns.author).toBeDefined()
  })

  it('does not eagerly resolve relation() targets, so build order/self-references are safe', () => {
    const Posts = defineCollection({ slug: 'posts-bad-rel', fields: { author: relation('nope') } })
    // 'nope' isn't in the batch — resolution is deferred until drizzle
    // actually needs the referenced column, so building the schema itself
    // doesn't throw.
    expect(() => buildSchema([Posts])).not.toThrow()
  })

  it('supports a self-referencing relation() within the same batch', () => {
    const Comments = defineCollection({
      slug: 'comments',
      fields: { parent: relation('comments') },
    })
    const tables = buildSchema([Comments])
    const columns = getTableColumns(tables.comments!)
    expect(columns.parent).toBeDefined()
  })

  it('stores hasMany select()/relation() as JSON columns', () => {
    const Posts = defineCollection({
      slug: 'posts-many',
      fields: {
        tags: select(['a', 'b']).hasMany(),
        related: relation('posts-many').hasMany(),
      },
    })
    const tables = buildSchema([Posts])
    const columns = getTableColumns(tables['posts-many']!)
    expect(columns.tags).toBeDefined()
    expect(columns.related).toBeDefined()
  })
})
