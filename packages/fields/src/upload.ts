import { baseDescriptor, IndexableFieldBuilder } from './builder.js'
import type { UploadDescriptor } from './descriptor.js'

export interface UploadValue {
  key: string
  filename: string
  mimeType: string
  filesize: number
}

export class UploadBuilder extends IndexableFieldBuilder<UploadDescriptor> {
  accept(mimeTypes: string[]): this {
    this.assertMutable()
    this.descriptor.accept = mimeTypes
    return this
  }
}

/** `slug` names which storage adapter/bucket config to use if more than one is configured. */
export function upload(slug?: string): UploadBuilder {
  return new UploadBuilder({ ...baseDescriptor('upload'), adapter: slug })
}
