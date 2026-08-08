/**
 * A document's actual over-the-wire shape: JSON has no Date, so every
 * `date()`/`timestamp()` field that comes back as a `Date` in the field
 * system's own `InferFields` (docs/FIELDS.md#type-inference) arrives here as
 * an ISO string instead — this mapped type keeps response types honest about
 * that instead of lying that a parsed JSON value is a `Date` instance.
 */
export type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T

/** The implicit id/createdAt/updatedAt columns every collection/single document carries, see docs/SPEC.md#primary-keys. */
export type WithTimestamps<T> = T & { id: string; createdAt: string; updatedAt: string }
