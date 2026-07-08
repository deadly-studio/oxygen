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
```

`condition` is validation-only in v1 — there's no admin UI yet to conditionally hide/show a field, but
the constraint still matters for API validation. `siblingData` is scoped to the nesting level the field
lives at: inside a `group` or an `array`/`blocks` item, siblings are that item's own fields, not the
whole document. `fullDoc` is always the top-level payload, for conditions that cross levels. A field
whose condition evaluates `false` is treated as absent: `.required()` is relaxed, and a submitted value
is rejected rather than silently accepted.

Each builder call mutates and returns the same builder instance (not copy-on-write) — builders are
constructed once at collection-definition time and never touched again after being assigned into a
`fields` map, so there's no aliasing hazard to design around.

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

## Leaf fields

| Field | TS value type | Column(s) | Notes |
|---|---|---|---|
| `text()` | `string` | `TEXT` | `.minLength()`, `.maxLength()` |
| `textarea()` | `string` | `TEXT` | Alias of `text()` — admin-UI hint only |
| `richText()` | `unknown` | `TEXT` (JSON) | Opaque pass-through; no structure enforced until phase 12's editor defines one |
| `number()` | `number` | `INTEGER` or `REAL` | `.int()` selects `INTEGER`, default `REAL`. `.min()`, `.max()` |
| `boolean()` | `boolean` | `INTEGER` (0/1) | |
| `select(options)` | union of option values, or `T[]` with `.hasMany()` | `TEXT`, or `TEXT` (JSON) if `hasMany` | `options: string[] \| { value, label }[]` |
| `date()` / `timestamp()` | `Date` | `INTEGER` (unix ms) | `.default('now')` |
| `json()` | `unknown` | `TEXT` (JSON) | Escape hatch — validated only as "parses" |

## Relational fields

| Field | TS value type | Column(s) | Notes |
|---|---|---|---|
| `relation(slug)` | `number`, or `number[]` with `.hasMany()` | `INTEGER` FK, or `TEXT` (JSON array of ids) if `hasMany` | hasMany relations are hydrated app-side in v1, not SQL-joinable |
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

Every builder produces a plain descriptor, not a Drizzle-aware object — the field/type system in
`packages/fields` never imports `drizzle-orm`. The base shape:

```ts
interface FieldDescriptor<TKind extends string = string> {
  kind: TKind
  required: boolean
  unique: boolean
  default?: unknown | (() => unknown)
  indexed: boolean
  condition?: (siblingData: unknown, fullDoc: unknown) => boolean
}
```

Kind-specific descriptors extend it — e.g.:

```ts
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

## Type inference

Document types are inferred from the field map, not hand-declared, via a mapped type over
`FieldDescriptor`s — sketch:

```ts
type InferField<D extends FieldDescriptor> =
  D extends { kind: 'text' | 'textarea' } ? string :
  D extends { kind: 'number' } ? number :
  D extends { kind: 'boolean' } ? boolean :
  D extends { kind: 'select'; hasMany: infer M } ? (M extends true ? string[] : string) :
  D extends { kind: 'date' } ? Date :
  D extends { kind: 'relation'; hasMany: infer M } ? (M extends true ? number[] : number) :
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
