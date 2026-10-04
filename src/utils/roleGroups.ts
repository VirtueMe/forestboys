/**
 * Group the people at a place by their role — Instruktør, Opplæring,
 * Stasjonert … — for the station page. Pure, so the order is testable.
 */

/** Roles that come first, in this order; everything else follows by name. */
export const ROLE_GROUP_ORDER = ['instructor', 'training', 'stationed'] as const

export interface RoleGroup<T> {
  /** The role key; null for links with no role. */
  role:    string | null
  entries: T[]
}

/**
 * Groups `entries` by `role`. Groups come in ROLE_GROUP_ORDER first, then the
 * other roles by their display name (`nameOf`, falling back to the key), and
 * links without a role last. Within a group the entries keep their order.
 */
export function groupByRole<T extends { role?: string | null }>(
  entries: readonly T[],
  nameOf: (key: string) => string = key => key,
): RoleGroup<T>[] {
  const byRole = new Map<string | null, T[]>()
  for (const e of entries) {
    const key = e.role || null
    const list = byRole.get(key)
    if (list) list.push(e)
    else byRole.set(key, [e])
  }

  const rank = (key: string | null): number => {
    if (key === null) return Number.MAX_SAFE_INTEGER
    const i = (ROLE_GROUP_ORDER as readonly string[]).indexOf(key)
    return i >= 0 ? i : ROLE_GROUP_ORDER.length
  }

  return [...byRole.entries()]
    .map(([role, list]): RoleGroup<T> => ({ role, entries: list }))
    .sort((a, b) =>
      rank(a.role) - rank(b.role) ||
      (a.role && b.role ? nameOf(a.role).localeCompare(nameOf(b.role), 'nb') : 0),
    )
}
