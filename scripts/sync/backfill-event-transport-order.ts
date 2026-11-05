/**
 * Copy Sanity's order of the transport on each event onto the graph's USED edges (#398).
 *
 * Only edges without an `order` are set, so an order an editor saved stays and a second run
 * changes nothing. Transport an editor added (not in Sanity) gets no order and sorts last.
 *
 * Usage: npx tsx scripts/sync/backfill-event-transport-order.ts [--write]
 */

import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import { neo4jDriver } from '../lib/person-sync.ts'
import { fetchSanityEvents } from '../lib/event-sync.ts'
import { loadLookups } from '../lib/event-rule.ts'
import { planTransportOrder, TRANSPORT_ORDER_QUERY, TRANSPORT_ORDER_COUNT_QUERY } from '../lib/event-transport-order.ts'
loadEnv()

const write = process.argv.includes('--write')

async function main() {
  const docs = await fetchSanityEvents()
  const driver = neo4jDriver()
  const session = driver.session({ defaultAccessMode: write ? neo4j.session.WRITE : neo4j.session.READ })
  try {
    const rows = planTransportOrder(docs, await loadLookups(session))
    const places = rows.reduce((n, r) => n + r.transport.length, 0)
    console.log(`${docs.length} Sanity events; ${rows.length} with transport, ${places} places in all`)

    const res = await session.run(write ? TRANSPORT_ORDER_QUERY : TRANSPORT_ORDER_COUNT_QUERY, { rows })
    const n = res.records[0].get('n')
    console.log(write ? `Set order on ${n} edges.` : `Dry run: ${n} edges would get an order. Pass --write to set them.`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
