# oxygen field system

The independent field/type system from `BUILD_PLAN.md` phase 2 — decoupled from Drizzle's column
types, with a translation layer that lowers it to Drizzle columns + migrations. This doc is the
detailed design; `docs/SPEC.md`'s field catalog table is the quick-reference summary.

## Builder API

Every field is a factory function (`text()`, `relation('users')`, `group({...})`, ...) returning a
chainable builder over a common base, regardless of kind:

```ts
.required()
.unique()
.default(value | (() => value))
.index()
.condition((siblingData: unknown, fullDoc: unknown) => boolean)
.validate(fn: Validator<TValue>)
```

`condition` is validation-only in v1 — there's no admin UI yet to conditionally hide/show a field, but
the constraint still matters for API validation. `siblingData` is scoped to the nesting level the field
lives at: inside a `group` or an `array`/`blocks` item, siblings are that item's own fields, not the
whole document. `fullDoc` is always the top-level payload, for conditions that cross levels. A field
whose condition evaluates `false` is treated as absent: `.required()` is relaxed, and a submitted value
is rejected rather than silently accepted.

Each builder call mutates and returns the same builder instance (not copy-on-write) — cheap and simple
for the common case of a field declared once, inline, and never touched again. It does reintroduce an
aliasing hazard the moment a field is shared across more than one collection — see
[Reusing fields across collections](#reusing-fields-across-collections) for why and how that's handled.

### Validation

Type-specific constraints stay on the builders they apply to, rather than generalizing `.min()`/`.max()`
across incompatible meanings (string length vs numeric value vs row count):

| Method | Applies to | Checks |
|---|---|---|
| `.minLength(n)` / `.maxLength(n)` | `text()`, `textarea()` | String length |
| `.matches(regex)` | `text()`, `textarea()` | Pattern match |
| `.min(n)` / `.max(n)` | `number()`, `date()`/`timestamp()` | Numeric/date value bounds |
| `.minRows(n)` / `.maxRows(n)` | `array()`, `blocks()` | Item count |

On top of those, `.validate(fn)` is on the shared base — the escape hatch for anything a built-in check
can't express (cross-field rules, external lookups):

```ts
type Validator<TValue> = (
  value: TValue,
  ctx: { siblingData: unknown; fullDoc: unknown; operation: 'create' | 'update' }
) => true | string | Promise<true | string>
```

Returns `true` if valid, or an error message string (becomes that field's `message` in the
`{ errors: [...] }` response from `docs/SPEC.md`). `.validate()` is stackable — each call appends
another validator rather than replacing the previous one, and they run in registration order. Evaluation
order per field: built-in checks first (`required`, `unique`, `minLength`/`matches`/`min`/etc.) since
they're cheap and synchronous, then registered `.validate()` calls in order, short-circuiting on the
first failure — so an expensive async validator never runs against a value that already fails a cheap
sync check.

### Field map, not field array

```ts
fields: {
  title: text().required(),
  author: relation('users'),
}
```

A plain object keyed by field slug, where the key *is* the column name. Payload uses an array of field
configs instead, because it needs to support unnamed, layout-only fields (`Row`, `Tabs`,
`Collapsible`) that arrange admin-UI real estate without owning any data — those can't be object keys
since they have no name. oxygen has no admin UI in v1, so there are no layout-only fields to
accommodate, and the object map is strictly better for us: it gives free TypeScript inference of the
document shape via a mapped type, and it's the more natural fit for a code-first config. Revisit if
phase 12's admin UI turns out to need pure-layout fields — that's an additive change (a parallel array
form), not a breaking one.

### Reusing fields across collections

A field builder is a mutable object — `.required()` et al. mutate and return `this` (see
[Builder API](#builder-api)) — which is fine for a field declared once, inline, but breaks the moment
the same field object is shared across collections and customized per site. An SEO group reused across
`Posts`, `Pages`, and `Products`, say: if any one of those sites does `group({ ...seoFields, title:
seoFields.title.required() })` to make `title` required just there, that `.required()` call mutates the
one shared `text()` instance every other site also references — silently making it required everywhere,
not just where it was meant to apply. Same failure mode for `.validate()`, since it appends to a
`validators` array living on the shared descriptor.

The sanctioned way to share fields is a factory, not a shared object:

```ts
export const seoFields = defineFields(() => ({
  title: text(),
  description: text(),
  image: upload('media'),
}))

const Posts = defineCollection({ fields: { seo: group(seoFields()), /* ... */ } })
const Pages = defineCollection({ fields: { seo: group(seoFields()), /* ... */ } })
```

Every call to `seoFields()` returns fresh builder instances, so each collection's copy is independent —
`Pages` can chain `.required()` onto its own copy of `title` without touching `Posts`'s. `defineFields` is
mostly a documented convention (a typed identity function) rather than doing real work itself; the actual
safety net is that a builder is **sealed** the first time it's consumed by `defineCollection`/
`defineSingle`/`group`/`array`/`blocks` — any further mutating call on an already-sealed instance throws,
rather than silently corrupting whatever else shares it. A plain shared object without the factory
wrapper still works fine as long as nothing customizes it per site; the seal only fires on an actual
second *mutation*, not on read-only reuse.

## Leaf fields

| Field | TS value type | Column(s) | Notes |
|---|---|---|---|
| `text()` | `string` | `TEXT` | `.minLength()`, `.maxLength()` |
| `textarea()` | `string` | `TEXT` | Alias of `text()` — admin-UI hint only |
| `richText()` | `unknown` | `TEXT` (JSON) | Opaque pass-through; no structure enforced until phase 12's editor defines one |
| `number()` | `number` | `INTEGER` or `REAL` | `.int()` selects `INTEGER`, default `REAL`. `.min()`, `.max()` |
| `boolean()` | `boolean` | `INTEGER` (0/1) | |
| `select(options)` | union of option values (or plain `string`/`string[]` if `options` is a loader — see below) | `TEXT`, or `TEXT` (JSON) if `hasMany` | `options: SelectOptions \| SelectOptionsLoader`. For picking other rows in this DB, use `relation().hasMany()` instead — `select()` is for a hardcoded list or an external source |
| `date()` / `timestamp()` | `Date` | `INTEGER` (unix ms) | `.default('now')` |
| `json()` | `unknown` | `TEXT` (JSON) | Escape hatch — validated only as "parses" |

### `select()` — static options vs. external options

`select()` has exactly two forms. It is **not** the mechanism for referencing rows in another
collection — that's `relation(slug).hasMany()`. `select()`'s job is a fixed set of choices, or a set
sourced from somewhere outside oxygen's own database.

**Static** — a hardcoded, unchanging list. This is the common case (a product type, a status enum —
things that "never change," picked from a handful of options). Each option is a `{ value, label }`
pair — `value` is what gets persisted, `label` is purely presentational (what a client displays, never
what's stored):

```ts
select([
  { value: 'physical', label: 'Physical product' },
  { value: 'digital', label: 'Digital download' },
  { value: 'subscription', label: 'Subscription' },
])
```

A plain string is shorthand for `{ value: s, label: s }`, for the common case where there's no separate
display text — `select(['draft', 'published', 'archived'])` behaves identically to spelling out
`{ value: 'draft', label: 'draft' }` etc. Whichever form is used, **the document field always stores
`value`** — `label` never reaches the database column, it only ever appears in the options-listing
endpoint's response for a client to render.

**External loader** — for choices sourced from a third-party service (a currency list, a Stripe product
list, anything not in oxygen's own tables):

```ts
select(async ({ search, limit }) => {
  const results = await fetchFromSomeExternalApi({ query: search, limit })
  return results.map((r) => ({ value: r.code, label: r.name }))
})
```

```ts
type SelectOption = string | { value: string; label: string }
type SelectOptions = SelectOption[]
type SelectOptionsLoader = (ctx: { search?: string; limit?: number }) => Promise<SelectOptions>
```

No `db` in the loader context — deliberately. If the choices come from oxygen's own data, that's a
`relation()`, not a `select()` loader; a `select()` loader exists specifically for sources outside
oxygen's database, most often an external API call the consumer's own loader body makes with `fetch()`
(reading whatever API key it needs from its own environment — the loader is just a function the
consumer wrote, oxygen doesn't inject credentials).

Static and loader forms are validated differently on write, not just resolved differently for display:

- **Static**: the submitted value must match one of the options' `value`s (never a `label`) — enforced
  on every create/update, same as any other built-in check. Cheap, local, no reason not to.
- **Loader**: **not** re-validated against the live external list on write. Re-checking would put every
  create/update behind a third-party service's uptime and latency just to save a document. The field
  behaves like `text()` at write time — the loader exists purely to give a client something to call for
  suggestions. `.validate()` is still available if a consumer wants to opt into a strict check
  themselves.

This split also explains the type inference difference: a static array narrows to a literal union
(`'physical' | 'digital' | 'subscription'`) precisely because it's an enforced enum; a loader can't be
evaluated at the type level (and isn't enforced at the value level either), so it falls back to `string`
(or `string[]` with `.hasMany()`).

Neither form can be called directly from a browser — a loader because it may hold credentials the
browser shouldn't see (or just hit CORS against the third-party service), and both because there's no
admin UI yet to build the request. So oxygen generates the server-side route and any client (including
a future shadcn `Combobox`, or the typed client) calls that instead of the source directly:

```
GET /collections/:slug/fields/:field/options?search=&limit=
→ { "options": [{ "value": "physical", "label": "physical" }, ...] }
```

`search`/`limit` are forwarded into the loader so it can push filtering down to the external call rather
than fetching everything and filtering in memory; for a static array they're applied locally against the
in-memory list instead. Always normalized to `{ value, label }` pairs regardless of which form produced
them, and subject to the same field-level permission allow-list as everything else (an unreadable
field's options endpoint 404s, same as the field itself being absent from a read). No caching in v1 —
the loader runs fresh on every call; debouncing the request rate is the client's job (e.g. `cmdk`'s
built-in debounce inside shadcn's `Command`), not oxygen's.

## Relational fields

| Field | TS value type | Column(s) | Notes |
|---|---|---|---|
| `relation(slug)` | `string` (ULID), or `string[]` with `.hasMany()` | `TEXT` FK, or `TEXT` (JSON array of ids) if `hasMany` | See [Primary keys](./SPEC.md#primary-keys) for why ids are ULIDs, not integers. hasMany relations are hydrated app-side in v1, not SQL-joinable |
| `upload(slug?)` | `{ key, filename, mimeType, filesize }` | 4 flattened columns (same mechanism as `group()`) | `.accept(mimeTypes[])`. `slug` picks a storage adapter if more than one is configured |

## Organizational fields

The fields that nest other fields instead of storing a scalar.

### `group(fields)`

```ts
group({ heading: text(), image: upload('media') })
```

Flattened into prefixed columns on the parent table — `hero: group({ heading: text() })` produces
column `hero_heading`, no wrapper table. Purely a naming/nesting convenience: indexes, uniqueness, and
relations inside a group behave exactly as if the fields were declared at the top level.

Flattening can collide — two groups producing the same generated column name, a group colliding with a
top-level field, or landing on a reserved name (`id`, `createdAt`, `updatedAt`, see
[Primary keys](./SPEC.md#primary-keys)). `defineCollection()`/`defineSingle()` computes the full set of
generated column names up front and rejects any collision with a clear error naming both fields involved,
rather than letting it surface later as an obscure Drizzle/SQLite error about a duplicate column.

### `array(fields, { minRows?, maxRows? })`

```ts
array({ label: text().required(), url: text() })
```

Repeatable structured item. **v1 simplification** (per `docs/SPEC.md`): stored as a single `TEXT`
column serializing the whole array as JSON, not a child table — no SQL filtering or joins into
individual items yet. The nested `fields` are still used to generate a runtime validator for each
item's shape.

### `blocks(blockTypes)`

```ts
const PageSections = blocks({
  hero: { heading: text().required(), image: upload('media') },
  textBlock: { body: richText() },
  gallery: { images: relation('media').hasMany() },
})
```

Polymorphic array: each item is tagged with a `blockType` discriminator and validated against that
block type's own field set. Same storage strategy as `array()` — a single JSON `TEXT` column, one
JSON-serializable item shape per array entry:

```jsonc
[
  { "blockType": "hero", "heading": "Welcome", "image": { "key": "...", "filename": "..." } },
  { "blockType": "textBlock", "body": "..." }
]
```

Structurally it's `array()` plus a discriminator — no new storage mechanism, just a union of shapes and
per-`blockType` validation. This is the mechanism for flexible page-builder-style content (a page's
`sections` field where each section can be a different layout).

## Translation layer contract

Every builder produces a plain descriptor, not a Drizzle-aware object — the builder/descriptor module
never imports `drizzle-orm`. Only the separate translator submodule further down does; both live inside
`packages/fields` per the build plan's package layout, so the package as a whole does depend on
`drizzle-orm`, but nothing above the translator ever touches it. The base shape:

```ts
interface FieldDescriptor<TKind extends string = string> {
  kind: TKind
  required: boolean
  unique: boolean
  default?: unknown | (() => unknown)
  indexed: boolean
  condition?: (siblingData: unknown, fullDoc: unknown) => boolean
  validators: Validator<unknown>[]
}
```

Kind-specific descriptors extend it — e.g.:

```ts
interface TextDescriptor extends FieldDescriptor<'text'> {
  minLength?: number
  maxLength?: number
  matches?: RegExp
}

interface SelectDescriptor extends FieldDescriptor<'select'> {
  options: SelectOptions | SelectOptionsLoader
  hasMany: boolean
}

interface RelationDescriptor extends FieldDescriptor<'relation'> {
  to: string
  hasMany: boolean
}

interface GroupDescriptor extends FieldDescriptor<'group'> {
  fields: Record<string, FieldDescriptor>
}

interface BlocksDescriptor extends FieldDescriptor<'blocks'> {
  blocks: Record<string, Record<string, FieldDescriptor>>
  minRows?: number
  maxRows?: number
}
```

The translator (also in `packages/fields`, the one place that *does* import `drizzle-orm`) walks a
`Record<string, FieldDescriptor>` and pattern-matches on `kind`:

- Leaf kinds → one column, named after the map key.
- `upload` → 4 columns, same flattening rule as `group`.
- `group` → recurse into `fields`, prefixing generated column names with `${key}_`.
- `array` / `blocks` → one JSON `TEXT` column; `fields`/`blocks` are consumed only to build a runtime
  validator (via the same descriptor-walking logic, just emitting validation instead of columns), never
  additional columns.

This walk is the one place `defineCollection`/`defineSingle` and the CRUD generator actually meet
Drizzle — everything above it works purely in terms of descriptors.

The same descriptor walk drives write-time validation, independent of the column-generation walk: for
each field, run built-ins (`required`/`unique`/`minLength`/`matches`/`min`/etc. — for `select`, only a
*static* `options` array is checked for membership; a loader is never invoked on write, see
[`select()` — static options vs. external options](#select--static-options-vs-external-options)) then
the descriptor's `validators` array in order, short-circuiting per field on first failure and collecting
one `{ field, message }` entry per failing field into the `{ errors: [...] }` response.

## Type inference

Document types are inferred from the field map, not hand-declared, via a mapped type over
`FieldDescriptor`s — sketch:

```ts
// Pulls the persisted `value` literal out of an option, whether it's a bare
// string or a { value, label } pair — label never contributes to the type.
type SelectValue<T extends SelectOption> = T extends string ? T : T extends { value: infer V } ? V : never

type InferField<D extends FieldDescriptor> =
  D extends { kind: 'text' | 'textarea' } ? string :
  D extends { kind: 'number' } ? number :
  D extends { kind: 'boolean' } ? boolean :
  D extends { kind: 'select'; options: infer O; hasMany: infer M } ?
    (O extends SelectOptionsLoader
      ? (M extends true ? string[] : string)                                   // loader options can't be narrowed at the type level
      : (M extends true ? SelectValue<O[number]>[] : SelectValue<O[number]>)) : // static options narrow to a literal union of values
  D extends { kind: 'date' } ? Date :
  D extends { kind: 'relation'; hasMany: infer M } ? (M extends true ? string[] : string) : // string = ULID id
  D extends { kind: 'upload' } ? { key: string; filename: string; mimeType: string; filesize: number } :
  D extends { kind: 'group'; fields: infer F extends Record<string, FieldDescriptor> } ? InferFields<F> :
  D extends { kind: 'array'; fields: infer F extends Record<string, FieldDescriptor> } ? InferFields<F>[] :
  D extends { kind: 'blocks'; blocks: infer B extends Record<string, Record<string, FieldDescriptor>> }
    ? { [K in keyof B]: { blockType: K } & InferFields<B[K]> }[keyof B][]
    : unknown

type InferFields<F extends Record<string, FieldDescriptor>> = {
  [K in keyof F as F[K]['required'] extends true ? K : never]: InferField<F[K]>
} & {
  [K in keyof F as F[K]['required'] extends true ? never : K]?: InferField<F[K]>
}
```

`blocks` infers a discriminated union keyed on `blockType`, so consumer code narrows with a plain
`switch (section.blockType)` and gets the right fields for free.
