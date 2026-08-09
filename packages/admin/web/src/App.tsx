import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { SchemaResponse } from '@deadly-studio/oxygen'
import { api } from './api.js'
import type { CmsUser } from './api.js'
import { Sidebar } from './components/Sidebar.js'
import { CollectionEditPage } from './pages/CollectionEditPage.js'
import { CollectionListPage } from './pages/CollectionListPage.js'
import { LoginPage } from './pages/LoginPage.js'
import { SingleEditPage } from './pages/SingleEditPage.js'

function firstRoute(schema: SchemaResponse): string {
  if (schema.collections[0]) return `/collections/${schema.collections[0].slug}`
  if (schema.singles[0]) return `/singles/${schema.singles[0].slug}`
  return '/'
}

export function App() {
  const [user, setUser] = useState<CmsUser | null | undefined>(undefined) // undefined = still checking
  const [schema, setSchema] = useState<SchemaResponse | null>(null)

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
  }, [])

  useEffect(() => {
    if (user) api.schema().then(setSchema)
  }, [user])

  if (user === undefined) return <p className="loading-screen">Loading…</p>
  if (!user) return <LoginPage onLoggedIn={() => api.me().then((res) => setUser(res.user))} />
  if (!schema) return <p className="loading-screen">Loading…</p>

  return (
    <div className="app-shell">
      <Sidebar
        schema={schema}
        cmsEmail={user.email}
        onLogout={async () => {
          await api.logout()
          setUser(null)
        }}
      />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to={firstRoute(schema)} replace />} />
          {schema.collections.map((c) => (
            <Route key={c.slug} path={`/collections/${c.slug}`} element={<CollectionListPage resource={c} />} />
          ))}
          {schema.collections.map((c) => (
            <Route key={`${c.slug}-edit`} path={`/collections/${c.slug}/:id`} element={<CollectionEditPage resource={c} />} />
          ))}
          {schema.singles.map((s) => (
            <Route key={s.slug} path={`/singles/${s.slug}`} element={<SingleEditPage resource={s} />} />
          ))}
        </Routes>
      </main>
    </div>
  )
}
