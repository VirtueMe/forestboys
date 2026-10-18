/**
 * The number of each list item within its list, for the editor's list CSS (`data-list-index`, #124).
 * A list starts again after a paragraph or any block that is not a list item; a deeper level starts at 1
 * and carries on where it left off when the shallower item after it returns to its level; a list of the
 * other kind at the same level starts again. This is the editor's own rule (it numbers items the same
 * way), which it does not hand out.
 */

import { siblingLists } from './blockTree.ts'

export interface ListBlock {
  _key:      string
  _type:     string
  listItem?: string
  level?:    number
}

const cache = new WeakMap<readonly ListBlock[], Map<string, number>>()

/**
 * The numbers of every list in the description. A box and a table cell hold lists of blocks of their own
 * (#314), and each of those is numbered by itself: the first item of a cell's list is 1 whatever list came
 * before it, and a list in one cell does not continue in the next. One map for all, by block key.
 */
export function listIndexes(blocks: readonly ListBlock[]): Map<string, number> {
  const known = cache.get(blocks)
  if (known) return known

  const indexes = new Map<string, number>()
  for (const { list } of siblingLists(blocks)) numberList(list as readonly ListBlock[], indexes)

  cache.set(blocks, indexes)
  return indexes
}

/** Number the items of one list of siblings, by the editor's rule above. */
function numberList(list: readonly ListBlock[], indexes: Map<string, number>): void {
  const counters = new Map<string, Map<number, number>>()   // list kind → level → the last number given
  let previous: { listItem: string; level: number } | undefined

  for (const block of list) {
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
}
