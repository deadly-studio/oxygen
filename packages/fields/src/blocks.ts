import { baseDescriptor, FieldBuilder, sealFields } from './builder.js'
import type { FieldMap } from './builder.js'
import type { BlocksDescriptor, FieldDescriptor } from './descriptor.js'

export class BlocksBuilder<
  TBlocks extends Record<string, Record<string, FieldDescriptor>>,
> extends FieldBuilder<BlocksDescriptor<TBlocks>> {
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

type SealedBlocks<B extends Record<string, FieldMap>> = {
  [K in keyof B]: { [F in keyof B[K]]: ReturnType<B[K][F]['getDescriptor']> }
}

/**
 * Polymorphic array — each item tagged with a `blockType` discriminator and
 * validated against that block's own field set. Same JSON-column storage as
 * array(), see docs/FIELDS.md#blocksblocktypes.
 */
export function blocks<B extends Record<string, FieldMap>>(blockTypes: B): BlocksBuilder<SealedBlocks<B>> {
  const sealed = {} as SealedBlocks<B>
  for (const key of Object.keys(blockTypes) as (keyof B)[]) {
    sealed[key] = sealFields(blockTypes[key]) as SealedBlocks<B>[keyof B]
  }
  return new BlocksBuilder({ ...baseDescriptor('blocks'), blocks: sealed })
}
