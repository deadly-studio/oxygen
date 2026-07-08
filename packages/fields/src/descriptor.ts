// Plain-object contract between the builder layer and the translator/validator
// layers — see docs/FIELDS.md#translation-layer-contract. Nothing in this file
// imports drizzle-orm; that's translate.ts's job alone.

export type Operation = 'create' | 'update'

export type Validator<TValue = unknown> = (
  value: TValue,
  ctx: { siblingData: unknown; fullDoc: unknown; operation: Operation },
) => true | string | Promise<true | string>

export interface FieldDescriptor<TKind extends string = string> {
  kind: TKind
  required: boolean
  unique: boolean
  default?: unknown | (() => unknown)
  indexed: boolean
  condition?: (siblingData: unknown, fullDoc: unknown) => boolean
  validators: Validator<unknown>[]
}

export interface TextDescriptor extends FieldDescriptor<'text' | 'textarea'> {
  minLength?: number
  maxLength?: number
  matches?: RegExp
}

export interface RichTextDescriptor extends FieldDescriptor<'richText'> {}

export interface NumberDescriptor extends FieldDescriptor<'number'> {
  int: boolean
  min?: number
  max?: number
}

export interface BooleanDescriptor extends FieldDescriptor<'boolean'> {}

export type SelectOption = string | { value: string; label: string }
export type SelectOptions = SelectOption[]
export type SelectOptionsLoader = (ctx: {
  search?: string
  limit?: number
}) => Promise<SelectOptions>

export interface SelectDescriptor<
  TOptions extends SelectOptions | SelectOptionsLoader = SelectOptions | SelectOptionsLoader,
  THasMany extends boolean = boolean,
> extends FieldDescriptor<'select'> {
  options: TOptions
  hasMany: THasMany
}

export interface DateDescriptor extends FieldDescriptor<'date' | 'timestamp'> {
  min?: Date
  max?: Date
}

export interface JsonDescriptor extends FieldDescriptor<'json'> {}

export type RelationOnDelete = 'restrict' | 'setNull' | 'cascade'

export interface RelationDescriptor<THasMany extends boolean = boolean> extends FieldDescriptor<'relation'> {
  to: string
  hasMany: THasMany
  onDelete: RelationOnDelete
}

export interface UploadDescriptor extends FieldDescriptor<'upload'> {
  adapter?: string
  accept?: string[]
}

export interface GroupDescriptor<TFields extends Record<string, FieldDescriptor> = Record<string, FieldDescriptor>>
  extends FieldDescriptor<'group'> {
  fields: TFields
}

export interface ArrayDescriptor<TFields extends Record<string, FieldDescriptor> = Record<string, FieldDescriptor>>
  extends FieldDescriptor<'array'> {
  fields: TFields
  minRows?: number
  maxRows?: number
}

export interface BlocksDescriptor<
  TBlocks extends Record<string, Record<string, FieldDescriptor>> = Record<string, Record<string, FieldDescriptor>>,
> extends FieldDescriptor<'blocks'> {
  blocks: TBlocks
  minRows?: number
  maxRows?: number
}

export type AnyFieldDescriptor =
  | TextDescriptor
  | RichTextDescriptor
  | NumberDescriptor
  | BooleanDescriptor
  | SelectDescriptor
  | DateDescriptor
  | JsonDescriptor
  | RelationDescriptor
  | UploadDescriptor
  | GroupDescriptor
  | ArrayDescriptor
  | BlocksDescriptor

export const RESERVED_FIELD_NAMES = ['id', 'createdAt', 'updatedAt'] as const
