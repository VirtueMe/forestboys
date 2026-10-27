/**
 * Sanity's order of the people on an event, copied onto the edges (#355).
 *
 * The event sync compares `people` as a set and the import never stored the position, so the
 * graph lists them by name. This fills `order` from Sanity's array, only where an edge has none:
 * an order an editor saved is left alone, which also makes a second run change nothing.
 */
import { refs, slugOf, type Lookups } from './event-rule.ts'
import type { Doc } from './person-sync.ts'

export interface PeopleOrderRow {
  event:   string
  people:  string[]
}

/** Per event, the slugs of its people in Sanity's order — the ones the graph has. */
export function planPeopleOrder(docs: Doc[], lookups: Lookups): PeopleOrderRow[] {
  const rows: PeopleOrderRow[] = []
  for (const d of docs) {
    if (!slugOf(d)) continue
    const people = refs(d.people).map(id => lookups.Person.get(id)).filter((s): s is string => !!s)
    if (people.length) rows.push({ event: d._id, people })
  }
  return rows
}

const MATCH_EDGES = `
  UNWIND $rows AS row
  MATCH (e) WHERE (e:Operation OR e:Incident) AND e.sanityId = row.event
  UNWIND range(0, size(row.people) - 1) AS i
  MATCH (:Person {slug: row.people[i]})-[r:PARTICIPATED_IN|INVOLVED_IN]->(e)
  WHERE r.order IS NULL`

/** Sets `order` (1-based) on the edges that have none. Returns how many it set. */
export const PEOPLE_ORDER_QUERY = `${MATCH_EDGES}
  SET r.order = i + 1
  RETURN count(r) AS n`

/** The same match, read-only: how many edges the write would set. */
export const PEOPLE_ORDER_COUNT_QUERY = `${MATCH_EDGES}
  RETURN count(r) AS n`
