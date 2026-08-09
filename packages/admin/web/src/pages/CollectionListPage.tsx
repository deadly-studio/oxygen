import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { SerializedResource } from '@deadly-studio/oxygen'
import { api } from '../api.js'
import type { ListResult } from '../api.js'

export interface CollectionListPageProps {
  resource: SerializedResource
}

function formatCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function CollectionListPage({ resource }: CollectionListPageProps) {
  const navigate = useNavigate()
  const [result, setResult] = useState<ListResult | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  // First handful of fields, matching how the built-in query DSL/response
  // envelope has no notion of "which columns to show" — a real column picker
  // isn't built yet (see the "Known gaps" note in this package's README).
  const columns = Object.keys(resource.fields).slice(0, 5)

  useEffect(() => {
    setResult(null)
    setError(null)
    api
      .list(resource.slug, `?limit=20&page=${page}`)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
  }, [resource.slug, page])

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this document?')) return
    await api.remove(resource.slug, id)
    setResult((r) => (r ? { ...r, docs: r.docs.filter((d) => d.id !== id) } : r))
  }

  return (
    <div>
      <div className="page-header">
        <h1>{resource.slug}</h1>
        <button type="button" onClick={() => navigate(`/collections/${resource.slug}/new`)}>
          New
        </button>
      </div>

      {error && <p className="field-error">{error}</p>}

      {!result ? (
        <p>Loading…</p>
      ) : result.docs.length === 0 ? (
        <p className="empty-state">No documents yet.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {result.docs.map((doc) => (
                <tr key={String(doc.id)}>
                  {columns.map((c) => (
                    <td key={c}>{formatCell(doc[c])}</td>
                  ))}
                  <td className="row-actions">
                    <Link to={`/collections/${resource.slug}/${doc.id}`}>Edit</Link>
                    <button type="button" onClick={() => handleDelete(String(doc.id))}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button type="button" disabled={!result.hasPrevPage} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <span>
              Page {result.page} of {result.totalPages} ({result.totalDocs} total)
            </span>
            <button type="button" disabled={!result.hasNextPage} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  )
}
