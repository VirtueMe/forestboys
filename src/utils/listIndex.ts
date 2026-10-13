/**
 * The number of each list item within its list, for the editor's list CSS (`data-list-index`, #124).
 * A list starts again after a paragraph or any block that is not a list item; a deeper level starts at 1
 * and carries on where it left off when the shallower item after it returns to its level; a list of the
 * other kind at the same level starts again. This is the editor's own rule (it numbers items the same
 * way), which it does not hand out.
 */
export interface ListBlock {
  _key:      string
  _type:     string
  listItem?: string
  level?:    number
}

const cache = new WeakMap<readonly ListBlock[], Map<string, number>>()

export function listIndexes(blocks: readonly ListBlock[]): Map<string, number> {
  const known = cache.get(blocks)
  if (known) return known

  const indexes = new Map<string, number>()
  const counters = new Map<string, Map<number, number>>()   // list kind → level → the last number given
  let previous: { listItem: string; level: number } | undefined

  for (const block of blocks) {
    if (block._type !== 'block' || block.listItem === undefined || block.level === undefined) {
      counters.clear()
      previous = undefined
      continue
    }
    const { listItem, level } = block
    const levels = counters.get(listItem) ?? new Map<number, number>()

    if (!previous || (previous.listItem === listItem && previous.level < level)) {
      levels.set(level, 1)
    } else {
      // The other kind's counters at this level and deeper are over; this kind carries on.
      for (const [kind, other] of counters) {
        if (kind === listItem) continue
        for (const l of [...other.keys()]) if (l >= level) other.delete(l)
      }
      levels.set(level, (levels.get(level) ?? 0) + 1)
    }
    counters.set(listItem, levels)
    indexes.set(block._key, levels.get(level)!)
    previous = { listItem, level }
  }

  cache.set(blocks, indexes)
  return indexes
}
