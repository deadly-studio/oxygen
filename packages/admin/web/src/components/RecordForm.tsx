import type { SerializedField } from '@deadly-studio/oxygen'
import type { Doc } from '../api.js'
import { FieldInput } from './FieldInput.js'

export interface RecordFormProps {
  collectionSlug: string
  fields: Record<string, SerializedField>
  doc: Doc
  onChange: (doc: Doc) => void
  errors: Record<string, string>
}

/** Renders one `FieldInput` per top-level field — shared by collection and single edit forms. */
export function RecordForm({ collectionSlug, fields, doc, onChange, errors }: RecordFormProps) {
  return (
    <div className="record-form">
      {Object.entries(fields).map(([name, descriptor]) => (
        <FieldInput
          key={name}
          collectionSlug={collectionSlug}
          name={name}
          descriptor={descriptor}
          value={doc[name]}
          onChange={(value) => onChange({ ...doc, [name]: value })}
          error={errors[name]}
        />
      ))}
    </div>
  )
}
