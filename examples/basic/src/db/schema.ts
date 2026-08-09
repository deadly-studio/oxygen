import { webhookTables } from '@deadly-studio/oxygen'
import { cmsAuthTables } from '@deadly-studio/oxygen-auth'
import { buildSchema } from '@deadly-studio/oxygen-fields'
import { permissionsTables } from '@deadly-studio/oxygen-permissions'
import { Customers, Posts, SiteSettings } from '../collections.js'

/** Every table this app's `oxygen()` config needs — see docs/GUIDE.md#migrations. */
export const tables = {
  ...buildSchema([
    { slug: Posts.slug, fields: Posts.fields },
    { slug: Customers.slug, fields: Customers.fields },
    { slug: SiteSettings.slug, fields: SiteSettings.fields },
  ]),
  ...cmsAuthTables,
  ...permissionsTables,
  ...webhookTables,
}
