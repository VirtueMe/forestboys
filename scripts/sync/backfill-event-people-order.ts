/**
 * Copy Sanity's order of the people on each event onto the graph's edges (#355).
 *
 * Only edges without an `order` are set, so an order an editor saved stays and a second run
 * changes nothing. People an editor added (not in Sanity) get no order and sort last.
 *
 * Usage: npx tsx scripts/sync/backfill-event-people-order.ts [--write]
 */

import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import { neo4jDriver } from '../lib/person-sync.ts'
import { fetchSanityEvents } from '../lib/event-sync.ts'
import { loadLookups } from '../lib/event-rule.ts'
import { planPeopleOrder, PEOPLE_ORDER_QUERY, PEOPLE_ORDER_COUNT_QUERY } from '../lib/event-people-order.ts'
loadEnv()

const write = process.argv.includes('--write')

async function main() {
  const docs = await fetchSanityEvents()
  const driver = neo4jDriver()
  const session = driver.session({ defaultAccessMode: write ? neo4j.session.WRITE : neo4j.session.READ })
  try {
    const rows = planPeopleOrder(docs, await loadLookups(session))
    const places = rows.reduce((n, r) => n + r.people.length, 0)
    console.log(`${docs.length} Sanity events; ${rows.length} with people, ${places} places in all`)

    const res = await session.run(write ? PEOPLE_ORDER_QUERY : PEOPLE_ORDER_COUNT_QUERY, { rows })
    const n = res.records[0].get('n')
    console.log(write ? `Set order on ${n} edges.` : `Dry run: ${n} edges would get an order. Pass --write to set them.`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
