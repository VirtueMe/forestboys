/**
 * Move the event text the Sanity import made from the ABOUT shape to the one
 * the app reads and edits (#63):
 *
 *   (:Description {id: 'desc:event:<id>'})-[:ABOUT]->(event)
 *     becomes
 *   (event)-[:HAS_CONTENT {order}]->(:Description {id: 'desc:event:<id>'})
 *
 * Only `desc:event:` descriptions on Operations and Incidents are touched, and
 * the Description node itself is kept (id, content, author, dates). An event
 * that already has HAS_CONTENT sections of its own is left alone and listed:
 * the editor's text and the imported text need a human to decide the order.
 *
 * Dry run by default (read-only session, nothing written). With --write the
 * affected ids are saved to data/sanity-delta/event-descriptions-before-<time>.json
 * first, then the edges are moved in chunks.
 *
 * Which graph: local (.env, localhost only) unless --production, which reads
 * .env.production (PRODUCTION_NEO4J_*) and prints the target first, like the
 * other scripts (scripts/lib/env.ts).
 *
 * Usage: npx tsx scripts/migrate-event-descriptions.ts [--production] [--write]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv } from './lib/env.ts'
import { neo4jDriver } from './lib/person-sync.ts'
loadEnv()

const write = process.argv.includes('--write')
const CHUNK = 200

interface Row { id: string; slug: string; label: string; hasSections: boolean }

async function main() {
  const driver = neo4jDriver()
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const res = await read.run(`
      MATCH (d:Description)-[:ABOUT]->(e)
      WHERE (e:Operation OR e:Incident) AND d.id STARTS WITH 'desc:event:'
      RETURN d.id AS id, e.slug AS slug,
             CASE WHEN e:Operation THEN 'Operation' ELSE 'Incident' END AS label,
             EXISTS { (e)-[:HAS_CONTENT]->(:Description) } AS hasSections
      ORDER BY slug`)
    const rows = res.records.map(r => r.toObject() as Row)
    const move = rows.filter(r => !r.hasSections)
    const skip = rows.filter(r => r.hasSections)

    const done = await read.run(`
      MATCH (e)-[:HAS_CONTENT]->(d:Description)
      WHERE (e:Operation OR e:Incident) AND d.id STARTS WITH 'desc:event:'
      RETURN count(d) AS n`)

    console.log(`ABOUT descriptions on events: ${rows.length}`)
    console.log(`  to move:                   ${move.length}`)
    console.log(`  left alone (has sections): ${skip.length}`)
    console.log(`Already HAS_CONTENT:         ${done.records[0].get('n') as number}`)
    for (const s of skip) console.log(`  skipped ${s.label} ${s.slug} (${s.id})`)

    if (!write) {
      console.log('\nDry run. Nothing written. Add --write to move them.')
      return
    }
    if (!move.length) { console.log('\nNothing to move.'); return }

    const dir = resolve(process.cwd(), 'data', 'sanity-delta')
    mkdirSync(dir, { recursive: true })
    const file = resolve(dir, `event-descriptions-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify({ move, skipped: skip }) + '\n')
    console.log(`\nBackup of the ids: ${file}`)

    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    let moved = 0
    try {
      for (let i = 0; i < move.length; i += CHUNK) {
        const ids = move.slice(i, i + CHUNK).map(m => m.id)
        const r = await ws.executeWrite(tx => tx.run(`
          UNWIND $ids AS id
          MATCH (d:Description {id: id})-[a:ABOUT]->(e)
          WHERE (e:Operation OR e:Incident) AND NOT EXISTS { (e)-[:HAS_CONTENT]->(:Description) }
          MERGE (e)-[r:HAS_CONTENT]->(d)
          SET r.order = coalesce(d.order, 1)
          DELETE a
          RETURN count(d) AS n`, { ids }))
        moved += r.records[0].get('n') as number
      }
    } finally {
      await ws.close()
    }
    console.log(`Moved ${moved} of ${move.length}.`)
  } finally {
    await read.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
