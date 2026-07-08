/**
 * Resolves `'$currentUser'` literals anywhere in a `cms_permissions.scope`
 * filter — including nested inside operator objects like `{ $eq: '$currentUser' }`
 * or `$and`/`$or` arrays — to the requesting principal's id, before handing
 * the filter to `buildWhere` (the same grammar `?where=` uses, see
 * docs/SPEC.md#permissions).
 */
export function substituteCurrentUser(filter: unknown, currentUserId: string): unknown {
  if (filter === '$currentUser') return currentUserId
  if (Array.isArray(filter)) return filter.map((value) => substituteCurrentUser(value, currentUserId))
  if (filter && typeof filter === 'object') {
    return Object.fromEntries(
      Object.entries(filter).map(([key, value]) => [key, substituteCurrentUser(value, currentUserId)]),
    )
  }
  return filter
}
