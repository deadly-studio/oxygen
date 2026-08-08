/** See docs/SPEC.md#errors — `field` is omitted for non-field-scoped errors. */
export interface ApiError {
  field?: string
  message: string
}

/** Thrown for any non-2xx response — carries the exact `{ errors }` envelope the server sent. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly errors: ApiError[]

  constructor(status: number, errors: ApiError[]) {
    super(errors[0]?.message ?? `Request failed with status ${status}.`)
    this.name = 'ApiRequestError'
    this.status = status
    this.errors = errors
  }
}

export type FetchLike = typeof fetch

export interface HttpOptions {
  baseUrl: string
  fetch: FetchLike
  credentials?: NonNullable<RequestInit['credentials']>
  /** Re-evaluated per request, so a rotated app-user access token is picked up without re-creating the client. */
  headers?: () => Record<string, string> | undefined
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | undefined>
  body?: unknown
}

export function buildQueryString(query?: Record<string, string | undefined>): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value)
  }
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

/** Every client method funnels through here — one place for URL-building, JSON (de)serialization, and error mapping. */
export async function apiRequest<T>(http: HttpOptions, req: RequestOptions): Promise<T> {
  const url = `${http.baseUrl.replace(/\/$/, '')}${req.path}${buildQueryString(req.query)}`
  const headers: Record<string, string> = { ...http.headers?.() }
  let body: string | undefined
  if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(req.body)
  }

  const response = await http.fetch(url, {
    method: req.method,
    headers,
    body,
    credentials: http.credentials ?? 'include',
  })

  const text = await response.text()
  const json: unknown = text ? JSON.parse(text) : undefined

  if (!response.ok) {
    const errors =
      json && typeof json === 'object' && Array.isArray((json as { errors?: unknown }).errors)
        ? ((json as { errors: ApiError[] }).errors)
        : [{ message: response.statusText || 'Request failed.' }]
    throw new ApiRequestError(response.status, errors)
  }

  return json as T
}
