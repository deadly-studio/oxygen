import { defineCollection, defineSingle, relation, select, text, timestamp } from '@deadly-studio/oxygen-fields'

export const Posts = defineCollection({
  slug: 'posts',
  fields: {
    title: text().required(),
    body: text(),
    status: select(['draft', 'published']).default('draft'),
    publishedAt: timestamp(),
    author: relation('customers'),
  },
})

// auth: true opts this collection into its own OTP+JWT login namespace —
// see docs/GUIDE.md#app-user-auth-otp--jwt. `email` required+unique() is
// what appOtpAuth's self-service signup looks a caller up/creates a row by.
export const Customers = defineCollection({
  slug: 'customers',
  auth: true,
  fields: {
    email: text().required().unique(),
    name: text(),
  },
})

export const SiteSettings = defineSingle({
  slug: 'site-settings',
  fields: { supportEmail: text().required().default('support@example.com') },
})
