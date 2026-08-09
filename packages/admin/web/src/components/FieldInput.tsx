import { useEffect, useState } from 'react'
import type { SerializedField } from '@deadly-studio/oxygen'
import { api } from '../api.js'

export interface FieldInputProps {
  collectionSlug: string
  name: string
  descriptor: SerializedField
  value: unknown
  onChange: (value: unknown) => void
  error?: string
}

interface Option {
  value: string
  label: string
}

function normalizeOption(o: string | Option): Option {
  return typeof o === 'string' ? { value: o, label: o } : o
}

function dateToLocalInput(value: unknown): string {
  if (typeof value !== 'string') return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function FieldLabel({ name, required }: { name: string; required: boolean }) {
  return (
    <label className="field-label" htmlFor={name}>
      {name}
      {required ? ' *' : ''}
    </label>
  )
}

function FieldError({ error }: { error?: string }) {
  return error ? <p className="field-error">{error}</p> : null
}

/** A textarea backed by its own local text state, decoupled from `value` — a controlled input bound directly to the parsed JSON would revert mid-keystroke on invalid input. */
function JsonTextareaField({ name, descriptor, value, onChange, error }: FieldInputProps) {
  const [raw, setRaw] = useState(() => (value == null ? '' : JSON.stringify(value, null, 2)))
  return (
    <div className="field">
      <FieldLabel name={name} required={descriptor.required} />
      <textarea
        id={name}
        rows={4}
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value)
          try {
            onChange(e.target.value ? JSON.parse(e.target.value) : undefined)
          } catch {
            // keep typing — propagated to onChange once it's valid JSON again
          }
        }}
      />
      <p className="field-hint">raw JSON — a repeater UI isn't built yet</p>
      <FieldError error={error} />
    </div>
  )
}

export function FieldInput({ collectionSlug, name, descriptor, value, onChange, error }: FieldInputProps) {
  const [options, setOptions] = useState<Option[]>(
    Array.isArray(descriptor.options) ? (descriptor.options as (string | Option)[]).map(normalizeOption) : [],
  )

  useEffect(() => {
    if (descriptor.kind !== 'select' || descriptor.options !== 'loader') return
    let cancelled = false
    api
      .fieldOptions(collectionSlug, name)
      .then((res) => {
        if (!cancelled) setOptions(res.options)
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionSlug, name])

  switch (descriptor.kind) {
    case 'text':
    case 'textarea':
      return (
        <div className="field">
          <FieldLabel name={name} required={descriptor.required} />
          <input id={name} type="text" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
          <FieldError error={error} />
        </div>
      )

    case 'richText':
    case 'json':
      return (
        <div className="field">
          <FieldLabel name={name} required={descriptor.required} />
          <textarea
            id={name}
            rows={4}
            value={typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)}
            onChange={(e) => onChange(e.target.value)}
          />
          <FieldError error={error} />
        </div>
      )

    case 'number':
      return (
        <div className="field">
          <FieldLabel name={name} required={descriptor.required} />
          <input
            id={name}
            type="number"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
          <FieldError error={error} />
        </div>
      )

    case 'boolean':
      return (
        <div className="field field-checkbox">
          <label>
            <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
            {name}
          </label>
          <FieldError error={error} />
        </div>
      )

    case 'select': {
      const hasMany = Boolean(descriptor.hasMany)
      if (hasMany) {
        const selected = Array.isArray(value) ? (value as string[]) : []
        return (
          <div className="field">
            <FieldLabel name={name} required={descriptor.required} />
            <select
              id={name}
              multiple
              value={selected}
              onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <FieldError error={error} />
          </div>
        )
      }
      return (
        <div className="field">
          <FieldLabel name={name} required={descriptor.required} />
          <select id={name} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <FieldError error={error} />
        </div>
      )
    }

    case 'date':
    case 'timestamp':
      return (
        <div className="field">
          <FieldLabel name={name} required={descriptor.required} />
          <input
            id={name}
            type="datetime-local"
            value={dateToLocalInput(value)}
            onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined)}
          />
          <FieldError error={error} />
        </div>
      )

    case 'relation': {
      const hasMany = Boolean(descriptor.hasMany)
      const text = hasMany ? (Array.isArray(value) ? (value as string[]).join(', ') : '') : ((value as string) ?? '')
      return (
        <div className="field">
          <FieldLabel name={name} required={descriptor.required} />
          <input
            id={name}
            type="text"
            placeholder={hasMany ? 'comma-separated ids' : 'document id'}
            value={text}
            onChange={(e) =>
              onChange(
                hasMany
                  ? e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : e.target.value || undefined,
              )
            }
          />
          <p className="field-hint">
            relation → {String(descriptor.to)}
            {hasMany ? ' (many)' : ''} — raw id{hasMany ? 's' : ''}, no picker yet
          </p>
          <FieldError error={error} />
        </div>
      )
    }

    case 'upload': {
      const uploadValue = value as { key?: string; filename?: string } | null | undefined
      return (
        <div className="field">
          <FieldLabel name={name} required={descriptor.required} />
          <p className="field-hint">
            {uploadValue?.key
              ? `Uploaded: ${uploadValue.filename ?? uploadValue.key}`
              : 'No file — upload UI not built yet, see docs/GUIDE.md#storage-uploads for the raw flow.'}
          </p>
        </div>
      )
    }

    case 'group': {
      const groupValue = (value as Record<string, unknown>) ?? {}
      const nestedFields = (descriptor.fields as Record<string, SerializedField>) ?? {}
      return (
        <fieldset className="field-group">
          <legend>{name}</legend>
          {Object.entries(nestedFields).map(([key, nested]) => (
            <FieldInput
              key={key}
              collectionSlug={collectionSlug}
              name={key}
              descriptor={nested}
              value={groupValue[key]}
              onChange={(v) => onChange({ ...groupValue, [key]: v })}
            />
          ))}
        </fieldset>
      )
    }

    case 'array':
    case 'blocks':
      return (
        <JsonTextareaField
          collectionSlug={collectionSlug}
          name={name}
          descriptor={descriptor}
          value={value}
          onChange={onChange}
          error={error}
        />
      )

    default:
      return null
  }
}
