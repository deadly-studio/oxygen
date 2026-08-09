import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App.js'
import './styles.css'

/**
 * Where the admin bundle itself is served from (for client-side routing) —
 * distinct from api.ts's computeApiBase(), which is where oxygen()'s own
 * routes live. Convention: mounted at a path ending in `/admin` — see
 * docs/BUILD_PLAN.md#12-stretch-admin-ui.
 */
function computeBasename(): string {
  const path = window.location.pathname
  const index = path.indexOf('/admin')
  return index === -1 ? '/' : path.slice(0, index + '/admin'.length)
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('oxygen-admin: #root element not found.')

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter basename={computeBasename()}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
