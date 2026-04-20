/**
 * One-shot: set Person.type on every existing Person that doesn't have one.
 *   soldier   — has at least one outgoing HELD_RANK edge
 *   civilian  — otherwise
 *
 * Idempotent: leaves already-set types alone.
 */

import neo4j from 'neo4j-driver'
import * as dotenv from 'dotenv'
dotenv.config()

const dry = process.argv.includes('--dry')

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
  )
  const session = driver.session()
  try {
    // "Real" rank = anything that isn't the bulk migration default.
    // The migration wrote sourceRef ~ 'menig-soldier-baseline' on every
    // Person's fallback Menig assignment — treat those as civilian until
    // an admin verifies.
    const REAL_RANK_PREDICATE = `
      h.state = 'verified'
      OR (h.sourceRef IS NOT NULL AND NOT h.sourceRef CONTAINS 'menig-soldier-baseline')
    `.trim()

    const counts = await session.run(`
      MATCH (p:Person)
      WHERE p.type IS NULL
      WITH p, EXISTS { MATCH (p)-[h:HELD_RANK]->() WHERE ${REAL_RANK_PREDICATE} } AS soldier
      RETURN count(p) AS missing,
             sum(CASE WHEN soldier THEN 1 ELSE 0 END) AS wouldSoldier
    `)
    const r = counts.records[0]
    console.log(`Persons missing type: ${r.get('missing')}`)
    console.log(`→ would classify as soldier:  ${r.get('wouldSoldier')}`)
    console.log(`→ would classify as civilian: ${Number(r.get('missing')) - Number(r.get('wouldSoldier'))}`)

    if (dry) { console.log('\n(dry run — no writes)'); return }

    const written = await session.run(`
      MATCH (p:Person)
      WHERE p.type IS NULL
      WITH p, EXISTS { MATCH (p)-[h:HELD_RANK]->() WHERE ${REAL_RANK_PREDICATE} } AS soldier
      SET p.type = CASE WHEN soldier THEN "soldier" ELSE "civilian" END
      RETURN count(p) AS n
    `)
    console.log(`\nUpdated ${written.records[0]?.get('n')} Person nodes.`)
  } finally {
    await session.close()
    await driver.close()
  }
}
void main().catch(e => { console.error(e); process.exit(1) })
