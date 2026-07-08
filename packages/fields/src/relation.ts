import { baseDescriptor, FieldBuilder, IndexableFieldBuilder } from './builder.js'
import type { RelationDescriptor, RelationOnDelete } from './descriptor.js'

/**
 * `.hasMany()`-selected relation() — no FK, no `.unique()`/`.index()`/
 * `.onDelete()` (unenforced JSON array of ids), see
 * docs/FIELDS.md#relation-referential-integrity.
 */
export class RelationManyBuilder<TTo extends string> extends FieldBuilder<RelationDescriptor<true>> {}

export class RelationBuilder<TTo extends string> extends IndexableFieldBuilder<RelationDescriptor<false>> {
  /** Default 'restrict'. 'setNull' only valid when the relation isn't `.required()`. */
  onDelete(strategy: RelationOnDelete): this {
    this.assertMutable()
    this.descriptor.onDelete = strategy
    return this
  }

  hasMany(): RelationManyBuilder<TTo> {
    this.assertMutable()
    const descriptor = this.descriptor as unknown as RelationDescriptor<true>
    descriptor.hasMany = true
    this.seal()
    return new RelationManyBuilder<TTo>(descriptor)
  }
}

export function relation<TTo extends string>(to: TTo): RelationBuilder<TTo> {
  return new RelationBuilder<TTo>({
    ...baseDescriptor('relation'),
    to,
    hasMany: false,
    onDelete: 'restrict',
  })
}
