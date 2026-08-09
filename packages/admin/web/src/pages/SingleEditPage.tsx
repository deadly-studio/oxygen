import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { SerializedResource } from '@deadly-studio/oxygen'
import { api, ApiRequestError } from '../api.js'
import type { Doc } from '../api.js'
import { RecordForm } from '../components/RecordForm.js'

export interface SingleEditPageProps {
  resource: SerializedResource
}

export function SingleEditPage({ resource }: SingleEditPageProps) {
  const [doc, setDoc] = useState<Doc>({})
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.getSingle(resource.slug).then((d) => {
      setDoc(d)
      setLoading(false)
    })
  }, [resource.slug])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    setFormError(null)
    setSavedMessage(null)
    try {
      const res = await api.updateSingle(resource.slug, doc)
      setDoc(res.doc)
      setSavedMessage(res.message)
    } catch (err) {
      if (!(err instanceof ApiRequestError)) {
        setFormError('Something went wrong.')
      } else {
        const fieldErrors: Record<string, string> = {}
        let general: string | null = null
        for (const e2 of err.errors) {
          if (e2.field) fieldErrors[e2.field] = e2.message
          else general = e2.message
        }
        setErrors(fieldErrors)
        setFormError(general)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p>Loading…</p>

  return (
    <div>
      <h1>{resource.slug}</h1>
      <form onSubmit={handleSubmit}>
        <RecordForm collectionSlug={resource.slug} fields={resource.fields} doc={doc} onChange={setDoc} errors={errors} />
        {formError && <p className="field-error">{formError}</p>}
        {savedMessage && <p className="field-hint">{savedMessage}</p>}
        <button type="submit" disabled={saving}>
          Save
        </button>
      </form>
    </div>
  )
}
