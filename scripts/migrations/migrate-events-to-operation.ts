/**
 * One-shot: every Sanity event becomes an Operation — the shape closest to
 * Sanity's own event (organization, from/to, stations). Which of them are
 * single episodes is then proposed per event as an Operation → Incident
 * bundle (docs/SANITY-SYNC.md, "Events").
 *
 * Flips `(:Incident {sanityId})` with the shared rewrite in
 * functions/_lib/event-kind.ts (label, title → codeName, INVOLVED_IN →
 * PARTICIPATED_IN with properties, incident notes → operation notes).
 * Incidents created in the graph (no sanityId) are left alone.
 *
 * The flipped slugs are saved to data/sanity-delta/events-to-operation-<time>.json.
 * Undo is the inverse relabel of those slugs — not DEMOTE_TO_INCIDENT,
 * which strips ORCHESTRATED_BY.
 *
 * Usage: npx tsx scripts/migrate-events-to-operation.ts [--write]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import { PROMOTE_TO_OPERATION } from '../../functions/_lib/event-kind.ts'
import { neo4jDriver } from '../lib/person-sync.ts'
loadEnv()

const write = process.argv.includes('--write')
const CHUNK = 200

async function main() {
  const driver = neo4jDriver()
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const count = async (q: string) => (await session.run(q)).records[0].get(0) as number
    const before = {
      incidents:      await count(`MATCH (x:Incident) WHERE x.sanityId IS NOT NULL RETURN count(x)`),
      graphIncidents: await count(`MATCH (x:Incident) WHERE x.sanityId IS NULL RETURN count(x)`),
      operations:     await count(`MATCH (x:Operation) RETURN count(x)`),
      involved:       await count(`MATCH (:Person)-[r:INVOLVED_IN]->(x:Incident) WHERE x.sanityId IS NOT NULL RETURN count(r)`),
      notes:          await count(`MATCH (:Person)-[r:HAS_INCIDENT_NOTE]->(:Description)-[:ABOUT_INCIDENT]->(x:Incident) WHERE x.sanityId IS NOT NULL RETURN count(r)`),
    }
    const slugs = (await session.run(`MATCH (x:Incident) WHERE x.sanityId IS NOT NULL RETURN x.slug AS slug ORDER BY slug`))
      .records.map(r => r.get('slug') as string)
    console.log('Before:', before)
    console.log(`To flip: ${slugs.length} Incidents → Operation (${before.graphIncidents} graph-created Incidents stay)`)
    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }

    const dir = resolve(process.cwd(), 'data', 'sanity-delta')
    mkdirSync(dir, { recursive: true })
    const file = resolve(dir, `events-to-operation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify({ before, slugs }, null, 2) + '\n')
    console.log(`Snapshot: ${file}`)

    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    let flipped = 0
    try {
      for (let i = 0; i < slugs.length; i += CHUNK) {
        const r = await ws.executeWrite(tx => tx.run(PROMOTE_TO_OPERATION, { slugs: slugs.slice(i, i + CHUNK) }))
        flipped += r.records[0].get('flipped') as number
      }
    } finally {
      await ws.close()
    }

    const after = {
      incidents:   await count(`MATCH (x:Incident) WHERE x.sanityId IS NOT NULL RETURN count(x)`),
      operations:  await count(`MATCH (x:Operation) WHERE x.sanityId IS NOT NULL RETURN count(x)`),
      participated: await count(`MATCH (:Person)-[r:PARTICIPATED_IN]->(x:Operation) WHERE x.slug IN $slugs RETURN count(r)`.replace('$slugs', JSON.stringify(slugs))),
      withRef:     await count(`MATCH (:Person)-[r:PARTICIPATED_IN]->(x:Operation) WHERE x.sanityId IS NOT NULL AND r.sourceRef IS NOT NULL RETURN count(r)`),
      titleLeft:   await count(`MATCH (x:Operation) WHERE x.title IS NOT NULL RETURN count(x)`),
    }
    console.log(`Flipped ${flipped}.`, after)
    if (after.incidents !== 0 || after.participated !== before.involved) {
      console.error('Check failed: Incidents left or person edges lost.')
      process.exitCode = 1
    }
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
