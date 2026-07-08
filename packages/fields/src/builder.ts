import type { FieldDescriptor, Validator } from './descriptor.js'

const SEALED = Symbol('oxygen.sealed')

/**
 * Shared chainable base for every field kind. Mutates and returns `this` (not
 * copy-on-write) — see docs/FIELDS.md#builder-api. A builder seals the first
 * time it's consumed by defineCollection/defineSingle/group/array/blocks;
 * any mutating call after that throws, see
 * docs/FIELDS.md#reusing-fields-across-collections.
 */
export abstract class FieldBuilder<D extends FieldDescriptor> {
  protected readonly descriptor: D
  private [SEALED] = false

  constructor(descriptor: D) {
    this.descriptor = descriptor
  }

  protected assertMutable(): void {
    if (this[SEALED]) {
      throw new Error(
        `Cannot mutate this '${this.descriptor.kind}' field — it's already in use in another ` +
          'collection, single, group, array, or blocks definition. Share fields with defineFields() ' +
          'instead of reusing the same builder instance, see docs/FIELDS.md#reusing-fields-across-collections.',
      )
    }
  }

  /** @internal */
  seal(): void {
    this[SEALED] = true
  }

  /** @internal */
  getDescriptor(): D {
    return this.descriptor
  }

  required(): this {
    this.assertMutable()
    this.descriptor.required = true
    return this
  }

  default(value: unknown | (() => unknown)): this {
    this.assertMutable()
    this.descriptor.default = value
    return this
  }

  condition(fn: (siblingData: unknown, fullDoc: unknown) => boolean): this {
    this.assertMutable()
    this.descriptor.condition = fn
    return this
  }

  validate(fn: Validator<never>): this {
    this.assertMutable()
    this.descriptor.validators.push(fn as Validator<unknown>)
    return this
  }
}

/**
 * Adds `.unique()`/`.index()` — withheld from kinds whose storage is a
 * serialized JSON blob rather than a real column value (array(), blocks(),
 * json(), and relation()/select() once .hasMany() is applied), see
 * docs/FIELDS.md#builder-api.
 */
export abstract class IndexableFieldBuilder<D extends FieldDescriptor> extends FieldBuilder<D> {
  unique(): this {
    this.assertMutable()
    this.descriptor.unique = true
    return this
  }

  index(): this {
    this.assertMutable()
    this.descriptor.indexed = true
    return this
  }
}

export type AnyFieldBuilder = FieldBuilder<FieldDescriptor>

export type FieldMap = Record<string, AnyFieldBuilder>

/** The descriptor map a field map seals to — named so both sides of a generic boundary resolve to the same type instantiation. */
export type SealFieldMap<F extends FieldMap> = { [K in keyof F]: ReturnType<F[K]['getDescriptor']> }

/**
 * Seals every builder in a field map and extracts its descriptor — the point
 * where group()/array()/blocks()/defineCollection()/defineSingle() "consume"
 * their fields.
 */
export function sealFields<F extends FieldMap>(
  fields: F,
): { [K in keyof F]: ReturnType<F[K]['getDescriptor']> } {
  const result: Record<string, FieldDescriptor> = {}
  for (const [key, builder] of Object.entries(fields)) {
    builder.seal()
    result[key] = builder.getDescriptor()
  }
  return result as { [K in keyof F]: ReturnType<F[K]['getDescriptor']> }
}

export function baseDescriptor<TKind extends string>(kind: TKind): FieldDescriptor<TKind> {
  return {
    kind,
    required: false,
    unique: false,
    indexed: false,
    validators: [],
  }
}
