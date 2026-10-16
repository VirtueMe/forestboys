/**
 * The events listed on an entity's page (#284): operations and incidents, each with when it happened. An incident's
 * `date` is its start; an operation has `startDate` / `endDate`. The queries return that shape, the list sorts it.
 */
import { comparePartial } from './period.ts'

export interface EventListItem {
  slug:       string
  title:      string
  startDate?: string | null
  endDate?:   string | null
}

/** What an item sorts by: its start, else its end. */
const sortDate = (e: EventListItem) => e.startDate || e.endDate || ''

/**
 * Oldest first (or newest first), items without a date last either way, and the same date by title. Partial dates are
 * compared by the part both know, so 1943 and 1943-05-17 fall together and then go by title.
 */
export function sortEvents<T extends EventListItem>(items: readonly T[], ascending = true): T[] {
  return [...items].sort((a, b) => {
    const da = sortDate(a), db = sortDate(b)
    if (!da || !db) return da ? -1 : db ? 1 : a.title.localeCompare(b.title, 'nb')
    return (ascending ? comparePartial(da, db) : comparePartial(db, da)) || a.title.localeCompare(b.title, 'nb')
  })
}
