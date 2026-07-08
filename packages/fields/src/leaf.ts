import { baseDescriptor, IndexableFieldBuilder } from './builder.js'
import type { BooleanDescriptor, DateDescriptor, JsonDescriptor, NumberDescriptor, RichTextDescriptor, TextDescriptor } from './descriptor.js'
import { FieldBuilder } from './builder.js'

export class TextBuilder extends IndexableFieldBuilder<TextDescriptor> {
  minLength(n: number): this {
    this.assertMutable()
    this.descriptor.minLength = n
    return this
  }

  maxLength(n: number): this {
    this.assertMutable()
    this.descriptor.maxLength = n
    return this
  }

  matches(pattern: RegExp): this {
    this.assertMutable()
    this.descriptor.matches = pattern
    return this
  }
}

export function text(): TextBuilder {
  return new TextBuilder({ ...baseDescriptor('text') })
}

/** Alias of text() — no schema difference, just an admin-UI hint later. */
export function textarea(): TextBuilder {
  return new TextBuilder({ ...baseDescriptor('textarea') })
}

// richText() isn't in FIELDS.md's index()/unique()-exclusion list (that list
// names array/blocks/json/hasMany-relation/hasMany-select only), so unlike
// those it keeps the indexable base despite also being opaque JSON storage.
export class RichTextBuilder extends IndexableFieldBuilder<RichTextDescriptor> {}

export function richText(): RichTextBuilder {
  return new RichTextBuilder(baseDescriptor('richText'))
}

export class NumberBuilder extends IndexableFieldBuilder<NumberDescriptor> {
  int(): this {
    this.assertMutable()
    this.descriptor.int = true
    return this
  }

  min(n: number): this {
    this.assertMutable()
    this.descriptor.min = n
    return this
  }

  max(n: number): this {
    this.assertMutable()
    this.descriptor.max = n
    return this
  }
}

export function number(): NumberBuilder {
  return new NumberBuilder({ ...baseDescriptor('number'), int: false })
}

export class BooleanBuilder extends IndexableFieldBuilder<BooleanDescriptor> {}

export function boolean(): BooleanBuilder {
  return new BooleanBuilder(baseDescriptor('boolean'))
}

export class DateBuilder extends IndexableFieldBuilder<DateDescriptor> {
  override default(value: Date | 'now' | (() => Date)): this {
    return super.default(value)
  }

  min(value: Date): this {
    this.assertMutable()
    this.descriptor.min = value
    return this
  }

  max(value: Date): this {
    this.assertMutable()
    this.descriptor.max = value
    return this
  }
}

export function date(): DateBuilder {
  return new DateBuilder(baseDescriptor('date'))
}

export function timestamp(): DateBuilder {
  return new DateBuilder(baseDescriptor('timestamp'))
}

export class JsonBuilder extends FieldBuilder<JsonDescriptor> {}

export function json(): JsonBuilder {
  return new JsonBuilder(baseDescriptor('json'))
}
