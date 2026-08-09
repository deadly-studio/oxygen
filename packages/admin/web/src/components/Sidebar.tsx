import { NavLink } from 'react-router-dom'
import type { SchemaResponse } from '@deadly-studio/oxygen'

export interface SidebarProps {
  schema: SchemaResponse
  cmsEmail: string
  onLogout: () => void
}

export function Sidebar({ schema, cmsEmail, onLogout }: SidebarProps) {
  return (
    <nav className="sidebar">
      <div className="sidebar-title">oxygen admin</div>

      <div className="sidebar-section">Collections</div>
      <ul>
        {schema.collections.map((c) => (
          <li key={c.slug}>
            <NavLink to={`/collections/${c.slug}`} className={({ isActive }) => (isActive ? 'active' : '')}>
              {c.slug}
            </NavLink>
          </li>
        ))}
      </ul>

      {schema.singles.length > 0 && (
        <>
          <div className="sidebar-section">Singles</div>
          <ul>
            {schema.singles.map((s) => (
              <li key={s.slug}>
                <NavLink to={`/singles/${s.slug}`} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {s.slug}
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="sidebar-footer">
        <span>{cmsEmail}</span>
        <button type="button" onClick={onLogout}>
          Log out
        </button>
      </div>
    </nav>
  )
}
