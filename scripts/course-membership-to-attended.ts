/**
 * One-shot: for every (Person)-[:MEMBER_OF]->(Unit {type:"course"}), replace
 * with (Person)-[:ATTENDED]->(Unit) carrying the same props, then drop the
 * original MEMBER_OF edge.
 *
 * Course attendance isn't organizational membership — this keeps the
 * Medlemskap editor focused on Units people were actually part of.
 *
 * Idempotent: only touches MEMBER_OF → course-type Unit edges.
 */

import neo4j from 'neo4j-driver'
import { loadEnv } from './lib/env.ts'
loadEnv()

const dry = process.argv.includes('--dry')

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
  )
  const session = driver.session()
  try {
    const count = await session.run(`
      MATCH (p:Person)-[m:MEMBER_OF]->(u:Unit {type: 'course'})
      RETURN count(m) AS n
    `)
    console.log(`MEMBER_OF → course edges to migrate: ${count.records[0]?.get('n')}`)

    if (dry) { console.log('(dry run — no writes)'); return }

    const r = await session.run(`
      MATCH (p:Person)-[m:MEMBER_OF]->(u:Unit {type: 'course'})
      CREATE (p)-[:ATTENDED {
        role:        m.role,
        startDate:   m.startDate,
        endDate:     m.endDate,
        description: m.description,
        sourceRefs:  m.sourceRefs
      }]->(u)
      DELETE m
      RETURN count(*) AS n
    `)
    console.log(`Migrated ${r.records[0]?.get('n')} edges.`)
  } finally {
    await session.close()
    await driver.close()
  }
}
void main().catch(e => { console.error(e); process.exit(1) })
