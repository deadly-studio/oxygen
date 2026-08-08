/**
 * The `?where=` filter grammar from docs/SPEC.md#query-dsl-list-endpoint —
 * shorthand equality or an operator object, combinable with `$and`/`$or`.
 * Typed against `TDoc`'s top-level keys as a convenience, not a strict
 * guarantee: the server actually filters on real DB columns, which for a
 * `group()` field are flattened (`hero_heading`, not `hero.heading`) — this
 * type doesn't attempt to model that flattening, so a group/array/blocks
 * field's filter value is typed loosely as `unknown`. Known simplification,
 * matching the array()/blocks() "no filtering into contents" v1 limit.
 */
export type FilterOperator<T> = {
  $eq?: T
  $ne?: T
  $gt?: T
  $gte?: T
  $lt?: T
  $lte?: T
  $in?: T[]
  $nin?: T[]
  $like?: T extends string ? string : never
  $exists?: boolean
}

export type WhereFilter<TDoc> =
  | { $and: WhereFilter<TDoc>[]; $or?: never }
  | { $or: WhereFilter<TDoc>[]; $and?: never }
  | {
      [K in keyof TDoc]?: TDoc[K] extends object ? unknown : TDoc[K] | FilterOperator<TDoc[K]>
    }
