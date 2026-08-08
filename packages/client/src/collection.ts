import type { CollectionConfig, InferFields } from '@deadly-studio/oxygen-fields'
import { apiRequest } from './http.js'
import type { HttpOptions } from './http.js'
import type { ResourceDoc } from './resources.js'
import type { WhereFilter } from './where.js'

export interface ListResult<TDoc> {
  docs: TDoc[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasPrevPage: boolean
  hasNextPage: boolean
  prevPage: number | null
  nextPage: number | null
}

export interface FindParams<TDoc> {
  where?: WhereFilter<TDoc>
  /** `'field'` ascending, `'-field'` descending; an array is joined the same way as a comma-separated string. */
  sort?: string | string[]
  limit?: number
  page?: number
}

export interface SelectOptionsResult {
  options: { value: string; label: string }[]
}

interface MutationResponse<TDoc> {
  message: string
  doc: TDoc
}

/** REST client for one collection — see docs/SPEC.md#collections. */
export class CollectionClient<TConfig extends CollectionConfig> {
  readonly #http: HttpOptions
  readonly #path: string

  constructor(http: HttpOptions, slug: string) {
    this.#http = http
    this.#path = `/collections/${slug}`
  }

  find(params?: FindParams<ResourceDoc<TConfig>>): Promise<ListResult<ResourceDoc<TConfig>>> {
    return apiRequest(this.#http, {
      method: 'GET',
      path: this.#path,
      query: {
        where: params?.where ? JSON.stringify(params.where) : undefined,
        sort: Array.isArray(params?.sort) ? params.sort.join(',') : params?.sort,
        limit: params?.limit !== undefined ? String(params.limit) : undefined,
        page: params?.page !== undefined ? String(params.page) : undefined,
      },
    })
  }

  findById(id: string): Promise<ResourceDoc<TConfig>> {
    return apiRequest(this.#http, { method: 'GET', path: `${this.#path}/${id}` })
  }

  async create(data: InferFields<TConfig['fields']>): Promise<ResourceDoc<TConfig>> {
    const result = await apiRequest<MutationResponse<ResourceDoc<TConfig>>>(this.#http, {
      method: 'POST',
      path: this.#path,
      body: data,
    })
    return result.doc
  }

  async update(id: string, data: Partial<InferFields<TConfig['fields']>>): Promise<ResourceDoc<TConfig>> {
    const result = await apiRequest<MutationResponse<ResourceDoc<TConfig>>>(this.#http, {
      method: 'PATCH',
      path: `${this.#path}/${id}`,
      body: data,
    })
    return result.doc
  }

  async delete(id: string): Promise<{ message: string }> {
    return apiRequest(this.#http, { method: 'DELETE', path: `${this.#path}/${id}` })
  }

  /** Resolved `{ value, label }` options for a `select()` field — see docs/FIELDS.md#select--static-options-vs-external-options. */
  fieldOptions(field: string, params?: { search?: string; limit?: number }): Promise<SelectOptionsResult> {
    return apiRequest(this.#http, {
      method: 'GET',
      path: `${this.#path}/fields/${field}/options`,
      query: {
        search: params?.search,
        limit: params?.limit !== undefined ? String(params.limit) : undefined,
      },
    })
  }
}
