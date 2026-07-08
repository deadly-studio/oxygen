import { baseDescriptor, FieldBuilder, IndexableFieldBuilder } from './builder.js'
import type { SelectDescriptor, SelectOptions, SelectOptionsLoader } from './descriptor.js'

/**
 * `.hasMany()`-selected select() — no `.unique()`/`.index()` (JSON array
 * column), see docs/FIELDS.md#builder-api.
 */
export class SelectManyBuilder<
  TOptions extends SelectOptions | SelectOptionsLoader,
> extends FieldBuilder<SelectDescriptor<TOptions, true>> {}

export class SelectBuilder<
  TOptions extends SelectOptions | SelectOptionsLoader,
> extends IndexableFieldBuilder<SelectDescriptor<TOptions, false>> {
  hasMany(): SelectManyBuilder<TOptions> {
    this.assertMutable()
    const descriptor = this.descriptor as unknown as SelectDescriptor<TOptions, true>
    descriptor.hasMany = true
    this.seal()
    return new SelectManyBuilder<TOptions>(descriptor)
  }
}

/** Static, hardcoded choices — validated as an enum on write. */
export function select<const TOptions extends SelectOptions>(options: TOptions): SelectBuilder<TOptions>
/** External loader (a third-party source) — not re-validated on write. */
export function select(loader: SelectOptionsLoader): SelectBuilder<SelectOptionsLoader>
export function select(
  optionsOrLoader: SelectOptions | SelectOptionsLoader,
): SelectBuilder<SelectOptions | SelectOptionsLoader> {
  return new SelectBuilder({
    ...baseDescriptor('select'),
    options: optionsOrLoader,
    hasMany: false,
  })
}
