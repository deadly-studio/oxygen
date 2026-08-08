import type { InferFields, SingleConfig } from '@deadly-studio/oxygen-fields'
import { apiRequest } from './http.js'
import type { HttpOptions } from './http.js'
import type { ResourceDoc } from './resources.js'

interface MutationResponse<TDoc> {
  message: string
  doc: TDoc
}

/** REST client for one single — GET/PATCH only, see docs/SPEC.md#singles. */
export class SingleClient<TConfig extends SingleConfig> {
  readonly #http: HttpOptions
  readonly #path: string

  constructor(http: HttpOptions, slug: string) {
    this.#http = http
    this.#path = `/singles/${slug}`
  }

  get(): Promise<ResourceDoc<TConfig>> {
    return apiRequest(this.#http, { method: 'GET', path: this.#path })
  }

  async update(data: Partial<InferFields<TConfig['fields']>>): Promise<ResourceDoc<TConfig>> {
    const result = await apiRequest<MutationResponse<ResourceDoc<TConfig>>>(this.#http, {
      method: 'PATCH',
      path: this.#path,
      body: data,
    })
    return result.doc
  }
}
