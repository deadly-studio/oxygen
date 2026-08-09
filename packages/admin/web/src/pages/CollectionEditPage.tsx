import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { SerializedResource } from '@deadly-studio/oxygen'
import { api, ApiRequestError } from '../api.js'
import type { Doc } from '../api.js'
import { RecordForm } from '../components/RecordForm.js'

export interface CollectionEditPageProps {
  resource: SerializedResource
}

export function CollectionEditPage({ resource }: CollectionEditPageProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = !id || id === 'new'

  const [doc, setDoc] = useState<Doc>({})
  const [loading, setLoading] = useState(!isNew)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isNew) {
      setDoc({})
      setLoading(false)
      return
    }
    setLoading(true)
    api.get(resource.slug, id!).then((d) => {
      setDoc(d)
      setLoading(false)
    })
  }, [resource.slug, id, isNew])

  function applyErrors(err: unknown) {
    if (!(err instanceof ApiRequestError)) {
      setFormError('Something went wrong.')
      return
    }
    const fieldErrors: Record<string, string> = {}
    let general: string | null = null
    for (const e of err.errors) {
      if (e.field) fieldErrors[e.field] = e.message
      else general = e.message
    }
    setErrors(fieldErrors)
    setFormError(general)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      if (isNew) {
        const res = await api.create(resource.slug, doc)
        navigate(`/collections/${resource.slug}/${res.doc.id}`)
      } else {
        const res = await api.update(resource.slug, id!, doc)
        setDoc(res.doc)
      }
    } catch (err) {
      applyErrors(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p>Loading…</p>

  return (
    <div>
      <h1>{isNew ? `New ${resource.slug}` : `Edit ${resource.slug}`}</h1>
      <form onSubmit={handleSubmit}>
        <RecordForm collectionSlug={resource.slug} fields={resource.fields} doc={doc} onChange={setDoc} errors={errors} />
        {formError && <p className="field-error">{formError}</p>}
        <button type="submit" disabled={saving}>
          {isNew ? 'Create' : 'Save'}
        </button>
      </form>
    </div>
  )
}
