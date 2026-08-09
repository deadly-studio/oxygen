import type { SchemaResponse } from '@deadly-studio/oxygen'

export interface ApiFieldError {
  field?: string
  message: string
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly errors: ApiFieldError[]

  constructor(status: number, errors: ApiFieldError[]) {
    super(errors[0]?.message ?? `Request failed with status ${status}.`)
    this.name = 'ApiRequestError'
    this.status = status
    this.errors = errors
  }
}

declare global {
  interface Window {
    __OXYGEN_ADMIN_CONFIG__?: { apiBasePath?: string }
  }
}

/**
 * The admin bundle is prebuilt and mounted at an arbitrary path a consumer
 * picks (docs/BUILD_PLAN.md#12-stretch-admin-ui) — it has no build-time way
 * to know where oxygen()'s own routes live relative to it. Default
 * convention: mounted at `.../admin`, so the API base is everything before
 * that segment. `adminUI({ apiBasePath })` overrides this by injecting
 * `window.__OXYGEN_ADMIN_CONFIG__` into the served `index.html`.
 */
function computeApiBase(): string {
  const override = window.__OXYGEN_ADMIN_CONFIG__?.apiBasePath
  if (override !== undefined) return override.replace(/\/$/, '')
  const path = window.location.pathname
  const index = path.indexOf('/admin')
  return index === -1 ? '' : path.slice(0, index)
}

export const API_BASE = computeApiBase()

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const text = await response.text()
  const json: unknown = text ? JSON.parse(text) : undefined

  if (!response.ok) {
    const errors =
      json && typeof json === 'object' && Array.isArray((json as { errors?: unknown }).errors)
        ? (json as { errors: ApiFieldError[] }).errors
        : [{ message: response.statusText || 'Request failed.' }]
    throw new ApiRequestError(response.status, errors)
  }

  return json as T
}

export interface CmsUser {
  id: string
  email: string
  createdAt: string
  updatedAt: string
}

export const api = {
  schema: () => request<SchemaResponse>('/schema'),

  me: () => request<{ user: CmsUser }>('/auth/me'),
  requestOtp: (email: string) => request<{ message: string }>('/auth/otp/request', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyOtp: (email: string, code: string) =>
    request<{ user: CmsUser }>('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email, code }) }),
  logout: () => request<{ message: string }>('/auth/logout', { method: 'POST' }),

  list: (slug: string, query: string) => request<ListResult>(`/collections/${slug}${query}`),
  get: (slug: string, id: string) => request<Doc>(`/collections/${slug}/${id}`),
  create: (slug: string, data: Doc) =>
    request<{ message: string; doc: Doc }>(`/collections/${slug}`, { method: 'POST', body: JSON.stringify(data) }),
  update: (slug: string, id: string, data: Doc) =>
    request<{ message: string; doc: Doc }>(`/collections/${slug}/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (slug: string, id: string) => request<{ message: string }>(`/collections/${slug}/${id}`, { method: 'DELETE' }),
  fieldOptions: (slug: string, field: string) =>
    request<{ options: { value: string; label: string }[] }>(`/collections/${slug}/fields/${field}/options`),

  getSingle: (slug: string) => request<Doc>(`/singles/${slug}`),
  updateSingle: (slug: string, data: Doc) =>
    request<{ message: string; doc: Doc }>(`/singles/${slug}`, { method: 'PATCH', body: JSON.stringify(data) }),
}

export type Doc = Record<string, unknown>

export interface ListResult {
  docs: Doc[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasPrevPage: boolean
  hasNextPage: boolean
  prevPage: number | null
  nextPage: number | null
}
