import { baseDescriptor, IndexableFieldBuilder, sealFields } from './builder.js'
import type { FieldMap, SealFieldMap } from './builder.js'
import type { FieldDescriptor, GroupDescriptor } from './descriptor.js'

export class GroupBuilder<
  TFields extends Record<string, FieldDescriptor>,
> extends IndexableFieldBuilder<GroupDescriptor<TFields>> {}

/**
 * Flattened into prefixed columns on the parent table — no wrapper table.
 * Eagerly seals `fields` (they're "consumed" the moment they're nested here),
 * see docs/FIELDS.md#groupfields.
 */
export function group<F extends FieldMap>(fields: F): GroupBuilder<SealFieldMap<F>> {
  const sealed = sealFields(fields)
  return new GroupBuilder({ ...baseDescriptor('group'), fields: sealed })
}
