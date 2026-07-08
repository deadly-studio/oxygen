import { baseDescriptor, FieldBuilder, sealFields } from './builder.js'
import type { FieldMap, SealFieldMap } from './builder.js'
import type { ArrayDescriptor, FieldDescriptor } from './descriptor.js'

export class ArrayBuilder<
  TFields extends Record<string, FieldDescriptor>,
> extends FieldBuilder<ArrayDescriptor<TFields>> {
  minRows(n: number): this {
    this.assertMutable()
    this.descriptor.minRows = n
    return this
  }

  maxRows(n: number): this {
    this.assertMutable()
    this.descriptor.maxRows = n
    return this
  }
}

/**
 * Repeatable structured item, stored as a single JSON `TEXT` column (v1
 * simplification, no child table) — see docs/FIELDS.md#arrayfields-minrows-maxrows.
 */
export function array<F extends FieldMap>(fields: F): ArrayBuilder<SealFieldMap<F>> {
  const sealed = sealFields(fields)
  return new ArrayBuilder({ ...baseDescriptor('array'), fields: sealed })
}
