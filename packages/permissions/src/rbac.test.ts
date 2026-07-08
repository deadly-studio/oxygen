import { eq } from 'drizzle-orm'
import { oxygen, ulid } from '@deadly-studio/oxygen'
import { appOtpAuth, cmsRoles, cmsUserRoles, cmsUsers, otpAuth } from '@deadly-studio/oxygen-auth'
import { buildSchema, defineCollection, text } from '@deadly-studio/oxygen-fields'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rolePermissions } from './rbac.js'
import { cmsPermissions } from './tables.js'
import { codeFrom, createTestDb, fakeEmail, postJson, readJson } from './test-helpers.js'

const JWT_SECRET = 'test-jwt-secret-at-least-this-long'
const COOKIE_SECRET = 'test-cookie-secret-at-least-this-long'

const Posts = defineCollection({
  slug: 'posts',
  fields: { title: text().required(), authorId: text(), secret: text() },
})

const Customers = defineCollection({
  slug: 'customers',
  auth: true,
  fields: { email: text().required().unique() },
})

const Notes = defineCollection({
  slug: 'notes',
  fields: { title: text().required(), ownerId: text() },
})

type TestApp = Awaited<ReturnType<typeof createTestApp>>

async function createTestApp(email: ReturnType<typeof fakeEmail>) {
  const { db, cleanup } = await createTestDb(
    buildSchema([
      { slug: Posts.slug, fields: Posts.fields },
      { slug: Customers.slug, fields: Customers.fields },
      { slug: Notes.slug, fields: Notes.fields },
    ]),
  )
  const app = oxygen({
    db,
    collections: [Posts, Customers, Notes],
    auth: {
      cms: otpAuth({ email, cookieSecret: COOKIE_SECRET }),
      app: appOtpAuth({ email, jwtSecret: JWT_SECRET }),
    },
    permissions: rolePermissions({ jwtSecret: JWT_SECRET, cookieSecret: COOKIE_SECRET }),
  })
  return { app, db, cleanup }
}

function withCookie(init: RequestInit, cookie: string): RequestInit {
  return { ...init, headers: { ...init.headers, cookie } }
}

function patchJson(body: unknown) {
  return { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

function cookieFrom(res: Response): string {
  return res.headers.get('set-cookie')!.split(';')[0]!
}

/** Bootstraps the very first CMS user (becomes super-admin per docs/SPEC.md#bootstrapping-the-first-cms-user). */
async function loginBootstrapAdmin(app: TestApp['app'], email: ReturnType<typeof fakeEmail>) {
  await app.request('/auth/otp/request', postJson({ email: 'admin@example.com' }))
  const code = codeFrom(email.sent.at(-1)!)
  const res = await app.request('/auth/otp/verify', postJson({ email: 'admin@example.com', code }))
  return { cookie: cookieFrom(res), user: (await readJson(res)).user }
}

/** REST role/permission/user management is a separate follow-up (not this pass) — tests wire cms_users/roles/permissions up directly, standing in for it. */
async function createCmsUser(db: TestApp['db'], userEmail: string): Promise<string> {
  const id = ulid()
  const now = new Date()
  await db.insert(cmsUsers).values({ id, email: userEmail, createdAt: now, updatedAt: now })
  return id
}

async function loginCmsUser(app: TestApp['app'], email: ReturnType<typeof fakeEmail>, userEmail: string): Promise<string> {
  await app.request('/auth/otp/request', postJson({ email: userEmail }))
  const code = codeFrom(email.sent.at(-1)!)
  const res = await app.request('/auth/otp/verify', postJson({ email: userEmail, code }))
  return cookieFrom(res)
}

async function createRole(db: TestApp['db'], name: string): Promise<string> {
  const id = ulid()
  await db.insert(cmsRoles).values({ id, name })
  return id
}

async function assignRole(db: TestApp['db'], userId: string, roleId: string): Promise<void> {
  await db.insert(cmsUserRoles).values({ userId, roleId })
}

async function grantPermission(
  db: TestApp['db'],
  grant: { roleId: string; resource: string; action: 'create' | 'read' | 'update' | 'delete'; scope?: unknown; fields?: string[] | null },
): Promise<void> {
  await db.insert(cmsPermissions).values({
    id: ulid(),
    roleId: grant.roleId,
    resource: grant.resource,
    action: grant.action,
    scope: grant.scope ?? null,
    fields: grant.fields ?? null,
  })
}

describe('rolePermissions', () => {
  let email: ReturnType<typeof fakeEmail>
  let app: TestApp['app']
  let db: TestApp['db']
  const cleanups: (() => Promise<void>)[] = []

  beforeEach(async () => {
    email = fakeEmail()
    const created = await createTestApp(email)
    app = created.app
    db = created.db
    cleanups.push(created.cleanup)
  })

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!()
  })

  it('denies an anonymous request outright', async () => {
    const res = await app.request('/collections/posts')
    expect(res.status).toBe(403)
  })

  it('denies by default when the principal holds no matching permission row', async () => {
    const userId = await createCmsUser(db, 'editor@example.com')
    const roleId = await createRole(db, 'toothless-role')
    await assignRole(db, userId, roleId)
    const cookie = await loginCmsUser(app, email, 'editor@example.com')

    const res = await app.request('/collections/posts', { headers: { cookie } })
    expect(res.status).toBe(403)
  })

  it('lets the bootstrap super-admin bypass permission checks entirely, with zero cms_permissions rows', async () => {
    const { cookie } = await loginBootstrapAdmin(app, email)

    const createRes = await app.request('/collections/posts', withCookie(postJson({ title: 'Hello', authorId: 'whoever' }), cookie))
    expect(createRes.status).toBe(201)

    const listRes = await app.request('/collections/posts', { headers: { cookie } })
    expect(listRes.status).toBe(200)
  })

  it('scopes list/get to rows matching $currentUser, 404ing (not 403ing) an out-of-scope row', async () => {
    const { cookie: adminCookie } = await loginBootstrapAdmin(app, email)
    const editorId = await createCmsUser(db, 'editor@example.com')
    const roleId = await createRole(db, 'editor')
    await assignRole(db, editorId, roleId)
    await grantPermission(db, { roleId, resource: 'posts', action: 'read', scope: { authorId: '$currentUser' } })

    const mine = await readJson(
      await app.request('/collections/posts', withCookie(postJson({ title: 'Mine', authorId: editorId }), adminCookie)),
    )
    const theirs = await readJson(
      await app.request('/collections/posts', withCookie(postJson({ title: 'Theirs', authorId: 'somebody-else' }), adminCookie)),
    )

    const editorCookie = await loginCmsUser(app, email, 'editor@example.com')

    const listRes = await app.request('/collections/posts', { headers: { cookie: editorCookie } })
    const listBody = await readJson(listRes)
    expect(listBody.docs.map((d: any) => d.id)).toEqual([mine.doc.id])

    const getOwn = await app.request(`/collections/posts/${mine.doc.id}`, { headers: { cookie: editorCookie } })
    expect(getOwn.status).toBe(200)

    const getOther = await app.request(`/collections/posts/${theirs.doc.id}`, { headers: { cookie: editorCookie } })
    expect(getOther.status).toBe(404)
  })

  it('rejects a write touching a field outside the allow-list with a 403 field error, permitting an allowed one', async () => {
    const { cookie: adminCookie } = await loginBootstrapAdmin(app, email)
    const editorId = await createCmsUser(db, 'editor@example.com')
    const roleId = await createRole(db, 'editor')
    await assignRole(db, editorId, roleId)
    await grantPermission(db, { roleId, resource: 'posts', action: 'read', scope: { authorId: '$currentUser' } })
    await grantPermission(db, { roleId, resource: 'posts', action: 'update', scope: { authorId: '$currentUser' }, fields: ['title'] })

    const created = await readJson(
      await app.request('/collections/posts', withCookie(postJson({ title: 'Original', authorId: editorId }), adminCookie)),
    )
    const editorCookie = await loginCmsUser(app, email, 'editor@example.com')

    const allowed = await app.request(`/collections/posts/${created.doc.id}`, withCookie(patchJson({ title: 'Updated' }), editorCookie))
    expect(allowed.status).toBe(200)

    const disallowed = await app.request(
      `/collections/posts/${created.doc.id}`,
      withCookie(patchJson({ authorId: 'someone-else' }), editorCookie),
    )
    expect(disallowed.status).toBe(403)
    expect((await readJson(disallowed)).errors[0]).toMatchObject({ field: 'authorId' })
  })

  it('strips a field outside the read allow-list from the response', async () => {
    const { cookie: adminCookie } = await loginBootstrapAdmin(app, email)
    const viewerId = await createCmsUser(db, 'viewer@example.com')
    const roleId = await createRole(db, 'viewer')
    await assignRole(db, viewerId, roleId)
    await grantPermission(db, { roleId, resource: 'posts', action: 'read', fields: ['title'] })

    const created = await readJson(
      await app.request('/collections/posts', withCookie(postJson({ title: 'Visible', secret: 'shh' }), adminCookie)),
    )
    const viewerCookie = await loginCmsUser(app, email, 'viewer@example.com')

    const res = await app.request(`/collections/posts/${created.doc.id}`, { headers: { cookie: viewerCookie } })
    const doc = await readJson(res)
    expect(doc.title).toBe('Visible')
    expect(doc.secret).toBeUndefined()
    expect(doc.id).toBe(created.doc.id) // implicit columns always survive
  })

  it('ORs scope and unions fields across every role the principal holds', async () => {
    const { cookie: adminCookie } = await loginBootstrapAdmin(app, email)
    const userId = await createCmsUser(db, 'multi@example.com')
    const ownRole = await createRole(db, 'own-posts')
    const publicRole = await createRole(db, 'public-posts')
    await assignRole(db, userId, ownRole)
    await assignRole(db, userId, publicRole)
    await grantPermission(db, { roleId: ownRole, resource: 'posts', action: 'read', scope: { authorId: '$currentUser' }, fields: ['title'] })
    await grantPermission(db, { roleId: publicRole, resource: 'posts', action: 'read', scope: { title: 'Public' }, fields: ['authorId'] })

    const mine = await readJson(
      await app.request('/collections/posts', withCookie(postJson({ title: 'Mine', authorId: userId, secret: 'x' }), adminCookie)),
    )
    const publicPost = await readJson(
      await app.request(
        '/collections/posts',
        withCookie(postJson({ title: 'Public', authorId: 'somebody-else', secret: 'y' }), adminCookie),
      ),
    )
    await app.request('/collections/posts', withCookie(postJson({ title: 'Neither', authorId: 'somebody-else', secret: 'z' }), adminCookie))

    const cookie = await loginCmsUser(app, email, 'multi@example.com')
    const list = await readJson(await app.request('/collections/posts', { headers: { cookie } }))
    const ids = list.docs.map((d: any) => d.id).sort()
    expect(ids).toEqual([mine.doc.id, publicPost.doc.id].sort())

    // fields union: 'title' (from own-posts) + 'authorId' (from public-posts); 'secret' is in neither role's allow-list.
    for (const doc of list.docs) {
      expect(doc.secret).toBeUndefined()
      expect(typeof doc.title).toBe('string')
      expect(typeof doc.authorId).toBe('string')
    }
  })

  it("grants an app user the implicit 'self' role lazily, scoping their access to rows matching their own id", async () => {
    await app.request('/app/customers/auth/otp/request', postJson({ identifier: 'shopper@example.com' }))
    const code = codeFrom(email.sent.at(-1)!)
    const { accessToken, user } = await readJson(
      await app.request('/app/customers/auth/otp/verify', postJson({ identifier: 'shopper@example.com', code })),
    )

    const selfRoleBefore = await db.select().from(cmsRoles).where(eq(cmsRoles.name, 'self')).get()
    expect(selfRoleBefore).toBeUndefined() // not seeded until an app user's first permissions-checked request

    const firstTry = await app.request('/collections/notes', { headers: { authorization: `Bearer ${accessToken}` } })
    expect(firstTry.status).toBe(403) // seeded now, but has no grants yet

    const selfRole = await db.select().from(cmsRoles).where(eq(cmsRoles.name, 'self')).get()
    expect(selfRole).toBeDefined()

    // Standing in for the not-yet-built role-management REST surface — see createCmsUser's comment above.
    await grantPermission(db, { roleId: selfRole!.id, resource: 'notes', action: 'read', scope: { ownerId: '$currentUser' } })

    const { cookie: adminCookie } = await loginBootstrapAdmin(app, email)
    const mine = await readJson(
      await app.request('/collections/notes', withCookie(postJson({ title: 'Mine', ownerId: user.id }), adminCookie)),
    )
    await app.request('/collections/notes', withCookie(postJson({ title: 'Not mine', ownerId: 'someone-else' }), adminCookie))

    const list = await readJson(await app.request('/collections/notes', { headers: { authorization: `Bearer ${accessToken}` } }))
    expect(list.docs.map((d: any) => d.id)).toEqual([mine.doc.id])
  })
})
