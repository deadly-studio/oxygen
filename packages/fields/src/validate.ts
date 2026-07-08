import type {
  ArrayDescriptor,
  BlocksDescriptor,
  DateDescriptor,
  FieldDescriptor,
  GroupDescriptor,
  NumberDescriptor,
  Operation,
  RelationDescriptor,
  SelectDescriptor,
  TextDescriptor,
  UploadDescriptor,
} from './descriptor.js'

export interface FieldError {
  field: string
  message: string
}

export interface ValidateContext {
  operation: Operation
  fullDoc: unknown
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * Built-in, synchronous/cheap checks first, then the field's registered
 * `.validate()` stack in order, short-circuiting on first failure — see
 * docs/FIELDS.md#validation. `.unique()` isn't checked here: it needs a DB
 * round trip, which this pure function has no access to — the CRUD layer
 * (phase 3) enforces it via the SQL UNIQUE constraint the translator emits.
 */
async function checkBuiltins(descriptor: FieldDescriptor, value: unknown, path: string): Promise<string | null> {
  switch (descriptor.kind) {
    case 'text':
    case 'textarea': {
      const d = descriptor as TextDescriptor
      const str = value as string
      if (d.minLength !== undefined && str.length < d.minLength) {
        return `${path} must be at least ${d.minLength} characters.`
      }
      if (d.maxLength !== undefined && str.length > d.maxLength) {
        return `${path} must be at most ${d.maxLength} characters.`
      }
      if (d.matches && !d.matches.test(str)) {
        return `${path} does not match the required pattern.`
      }
      return null
    }
    case 'number': {
      const d = descriptor as NumberDescriptor
      const num = value as number
      if (d.int && !Number.isInteger(num)) {
        return `${path} must be an integer.`
      }
      if (d.min !== undefined && num < d.min) {
        return `${path} must be >= ${d.min}.`
      }
      if (d.max !== undefined && num > d.max) {
        return `${path} must be <= ${d.max}.`
      }
      return null
    }
    case 'date':
    case 'timestamp': {
      const d = descriptor as DateDescriptor
      const date = value as Date
      if (d.min && date.getTime() < d.min.getTime()) {
        return `${path} must be on or after ${d.min.toISOString()}.`
      }
      if (d.max && date.getTime() > d.max.getTime()) {
        return `${path} must be on or before ${d.max.toISOString()}.`
      }
      return null
    }
    case 'select': {
      const d = descriptor as SelectDescriptor
      if (typeof d.options === 'function') return null // loader: not re-validated on write
      const allowed = new Set(d.options.map((o) => (typeof o === 'string' ? o : o.value)))
      const values = d.hasMany ? (value as string[]) : [value as string]
      for (const v of values) {
        if (!allowed.has(v)) return `${path} must be one of the configured options.`
      }
      return null
    }
    case 'upload': {
      const d = descriptor as UploadDescriptor
      const upload = value as { mimeType?: string }
      if (d.accept && d.accept.length > 0 && upload.mimeType && !d.accept.includes(upload.mimeType)) {
        return `${path} must be one of: ${d.accept.join(', ')}.`
      }
      return null
    }
    case 'array': {
      const d = descriptor as ArrayDescriptor
      const items = value as unknown[]
      if (d.minRows !== undefined && items.length < d.minRows) {
        return `${path} must have at least ${d.minRows} item(s).`
      }
      if (d.maxRows !== undefined && items.length > d.maxRows) {
        return `${path} must have at most ${d.maxRows} item(s).`
      }
      return null
    }
    case 'blocks': {
      const d = descriptor as BlocksDescriptor
      const items = value as unknown[]
      if (d.minRows !== undefined && items.length < d.minRows) {
        return `${path} must have at least ${d.minRows} item(s).`
      }
      if (d.maxRows !== undefined && items.length > d.maxRows) {
        return `${path} must have at most ${d.maxRows} item(s).`
      }
      return null
    }
    case 'json': {
      try {
        JSON.stringify(value)
        return null
      } catch {
        return `${path} must be JSON-serializable.`
      }
    }
    default:
      return null
  }
}

async function validateField(
  key: string,
  descriptor: FieldDescriptor,
  siblingData: Record<string, unknown>,
  ctx: ValidateContext,
  path: string[],
  errors: FieldError[],
): Promise<void> {
  const fieldPath = [...path, key].join('.')
  const value = siblingData[key]

  if (descriptor.condition && !descriptor.condition(siblingData, ctx.fullDoc)) {
    if (!isEmpty(value)) {
      errors.push({ field: fieldPath, message: `${fieldPath} is not applicable.` })
    }
    return
  }

  if (descriptor.required && isEmpty(value)) {
    errors.push({ field: fieldPath, message: `${fieldPath} is required.` })
    return
  }

  if (isEmpty(value)) return

  const builtinError = await checkBuiltins(descriptor, value, fieldPath)
  if (builtinError) {
    errors.push({ field: fieldPath, message: builtinError })
    return
  }

  for (const validator of descriptor.validators) {
    const result = await validator(value, {
      siblingData,
      fullDoc: ctx.fullDoc,
      operation: ctx.operation,
    })
    if (result !== true) {
      errors.push({ field: fieldPath, message: result })
      return
    }
  }

  if (descriptor.kind === 'group') {
    await validateFields(
      (descriptor as GroupDescriptor).fields,
      (value as Record<string, unknown>) ?? {},
      ctx,
      [...path, key],
      errors,
    )
    return
  }

  if (descriptor.kind === 'array') {
    const items = value as Record<string, unknown>[]
    const itemFields = (descriptor as ArrayDescriptor).fields
    for (let i = 0; i < items.length; i++) {
      await validateFields(itemFields, items[i] ?? {}, ctx, [...path, key, String(i)], errors)
    }
    return
  }

  if (descriptor.kind === 'blocks') {
    const items = value as { blockType: string }[]
    const blockShapes = (descriptor as BlocksDescriptor).blocks
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const shape = item ? blockShapes[item.blockType] : undefined
      const itemPath = [...path, key, String(i)]
      if (!shape) {
        errors.push({
          field: itemPath.join('.'),
          message: `${itemPath.join('.')} has an unknown blockType '${item?.blockType}'.`,
        })
        continue
      }
      await validateFields(shape, (item as Record<string, unknown>) ?? {}, ctx, itemPath, errors)
    }
    return
  }

  if (descriptor.kind === 'relation' && !(descriptor as RelationDescriptor).hasMany) {
    // Referential integrity (does the target row exist?) is a DB-level FK
    // concern, enforced by the CRUD layer (phase 3) against the live schema
    // — not checkable from this pure descriptor walk.
  }
}

async function validateFields(
  fields: Record<string, FieldDescriptor>,
  data: Record<string, unknown>,
  ctx: ValidateContext,
  path: string[],
  errors: FieldError[],
): Promise<void> {
  for (const [key, descriptor] of Object.entries(fields)) {
    await validateField(key, descriptor, data, ctx, path, errors)
  }
}

export async function validateDocument(
  fields: Record<string, FieldDescriptor>,
  data: Record<string, unknown>,
  operation: Operation,
): Promise<FieldError[]> {
  const errors: FieldError[] = []
  await validateFields(fields, data, { operation, fullDoc: data }, [], errors)
  return errors
}
