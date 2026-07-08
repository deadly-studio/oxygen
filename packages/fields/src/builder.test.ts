import { describe, expect, it } from 'vitest'
import { array } from './array.js'
import { defineCollection } from './define.js'
import { group } from './group.js'
import { text } from './leaf.js'
import { relation } from './relation.js'
import { select } from './select.js'

describe('builder chaining', () => {
  it('mutates and returns the same instance', () => {
    const field = text()
    const chained = field.required().minLength(2).maxLength(10)
    expect(chained).toBe(field)
    expect(field.getDescriptor()).toMatchObject({ required: true, minLength: 2, maxLength: 10 })
  })

  it('select().hasMany() drops unique()/index() from the type and switches storage', () => {
    const many = select(['a', 'b']).hasMany()
    expect(many.getDescriptor()).toMatchObject({ hasMany: true, options: ['a', 'b'] })
    expect('unique' in many).toBe(false)
  })

  it('relation().hasMany() drops onDelete()/unique()/index()', () => {
    const many = relation('users').hasMany()
    expect(many.getDescriptor()).toMatchObject({ hasMany: true, to: 'users' })
    expect('onDelete' in many).toBe(false)
    expect('unique' in many).toBe(false)
  })
})

describe('sealing', () => {
  it('throws when mutating a field already consumed by a collection', () => {
    const title = text().required()
    defineCollection({ slug: 'posts', fields: { title } })
    expect(() => title.maxLength(5)).toThrow(/already in use/)
  })

  it('throws when mutating a field already consumed by group()', () => {
    const heading = text()
    group({ heading })
    expect(() => heading.required()).toThrow(/already in use/)
  })

  it('throws when mutating a field already consumed by array()', () => {
    const label = text()
    array({ label })
    expect(() => label.required()).toThrow(/already in use/)
  })

  it('a fresh builder instance from the same factory is independent', () => {
    const makeTitle = () => text().required()
    const a = makeTitle()
    const b = makeTitle()
    defineCollection({ slug: 'sealing-fresh', fields: { title: a } })
    expect(() => b.maxLength(5)).not.toThrow()
  })
})
