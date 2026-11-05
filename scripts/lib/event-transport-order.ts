/**
 * Sanity's order of the transport on an event, copied onto the USED edges (#398).
 *
 * Fills `order` from Sanity's array, only where an edge has none: an order an editor saved is left alone, which also
 * makes a second run change nothing.
 */
import { refs, slugOf, type Lookups } from './event-rule.ts'
import type { Doc } from './person-sync.ts'

export interface TransportOrderRow {
  event:     string
  transport: string[]
}

/** Per event, the slugs of its transport in Sanity's order — the ones the graph has. */
export function planTransportOrder(docs: Doc[], lookups: Lookups): TransportOrderRow[] {
  const rows: TransportOrderRow[] = []
  for (const d of docs) {
    if (!slugOf(d)) continue
    const transport = refs(d.transport).map(id => lookups.Transport.get(id)).filter((s): s is string => !!s)
    if (transport.length) rows.push({ event: d._id, transport })
  }
  return rows
}

const MATCH_EDGES = `
  UNWIND $rows AS row
  MATCH (e) WHERE (e:Operation OR e:Incident) AND e.sanityId = row.event
  UNWIND range(0, size(row.transport) - 1) AS i
  MATCH (e)-[r:USED]->(:Transport {slug: row.transport[i]})
  WHERE r.order IS NULL`

/** Sets `order` (1-based) on the edges that have none. Returns how many it set. */
export const TRANSPORT_ORDER_QUERY = `${MATCH_EDGES}
  SET r.order = i + 1
  RETURN count(r) AS n`

/** The same match, read-only: how many edges the write would set. */
export const TRANSPORT_ORDER_COUNT_QUERY = `${MATCH_EDGES}
  RETURN count(r) AS n`
