import type { FieldDescriptor, SelectOption, SelectOptions, SelectOptionsLoader } from './descriptor.js'

// Pulls the persisted `value` literal out of an option, whether it's a bare
// string or a { value, label } pair — label never contributes to the type.
type SelectValue<T extends SelectOption> = T extends string ? T : T extends { value: infer V } ? V : never

/** Document-shape inference from a field descriptor — see docs/FIELDS.md#type-inference. */
export type InferField<D extends FieldDescriptor> = D extends { kind: 'text' | 'textarea' }
  ? string
  : D extends { kind: 'richText' }
    ? unknown
    : D extends { kind: 'number' }
      ? number
      : D extends { kind: 'boolean' }
        ? boolean
        : D extends { kind: 'select'; options: infer O; hasMany: infer M }
          ? O extends SelectOptionsLoader
            ? M extends true
              ? string[]
              : string
            : O extends SelectOptions
              ? M extends true
                ? SelectValue<O[number]>[]
                : SelectValue<O[number]>
              : never
          : D extends { kind: 'date' | 'timestamp' }
            ? Date
            : D extends { kind: 'relation'; hasMany: infer M }
              ? M extends true
                ? string[]
                : string
              : D extends { kind: 'upload' }
                ? { key: string; filename: string; mimeType: string; filesize: number }
                : D extends { kind: 'group'; fields: infer F extends Record<string, FieldDescriptor> }
                  ? InferFields<F>
                  : D extends { kind: 'array'; fields: infer F extends Record<string, FieldDescriptor> }
                    ? InferFields<F>[]
                    : D extends {
                          kind: 'blocks'
                          blocks: infer B extends Record<string, Record<string, FieldDescriptor>>
                        }
                      ? { [K in keyof B]: { blockType: K } & InferFields<B[K]> }[keyof B][]
                      : D extends { kind: 'json' }
                        ? unknown
                        : unknown

export type InferFields<F extends Record<string, FieldDescriptor>> = {
  [K in keyof F as F[K]['required'] extends true ? K : never]: InferField<F[K]>
} & {
  [K in keyof F as F[K]['required'] extends true ? never : K]?: InferField<F[K]>
}
