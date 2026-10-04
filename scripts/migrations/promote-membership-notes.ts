/**
 * Promote scalar MEMBER_OF.description strings to Description nodes reachable
 * via the new note anchor:
 *
 *   (Person)-[:HAS_MEMBERSHIP_NOTE]->(Description)-[:ABOUT_UNIT]->(Unit)
 *
 * The Description gets a single-block Portable Text wrapper around the
 * legacy string, so it plugs into SectionsEditor / blocksToHtml without
 * special cases. MEMBER_OF.description is cleared after the move — the
 * note is the new source of truth.
 *
 * Idempotent: skips (person, unit) pairs where a note already exists.
 */

import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
loadEnv()

const dry = process.argv.includes('--dry')

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
  )
  const session = driver.session()
  try {
    const counts = await session.run(`
      MATCH (p:Person)-[m:MEMBER_OF]->(u:Unit)
      WHERE m.description IS NOT NULL AND m.description <> ''
        AND NOT EXISTS { (p)-[:HAS_MEMBERSHIP_NOTE]->(:Description)-[:ABOUT_UNIT]->(u) }
      RETURN count(m) AS migratable
    `)
    console.log(`Legacy descriptions to migrate: ${counts.records[0]?.get('migratable')}`)

    if (dry) { console.log('(dry run — no writes)'); return }

    const written = await session.run(`
      MATCH (p:Person)-[m:MEMBER_OF]->(u:Unit)
      WHERE m.description IS NOT NULL AND m.description <> ''
        AND NOT EXISTS { (p)-[:HAS_MEMBERSHIP_NOTE]->(:Description)-[:ABOUT_UNIT]->(u) }
      WITH p, m, u,
           '[{"_type":"block","style":"normal","children":[{"_type":"span","text":' +
             apoc.convert.toJson(m.description) +
           ',"marks":[]}]}]' AS wrappedContent
      CREATE (d:Description {
        id: 'desc:membership:' + p.slug + ':' + u.slug,
        order: 1,
        content: wrappedContent
      })
      CREATE (p)-[:HAS_MEMBERSHIP_NOTE]->(d)
      CREATE (d)-[:ABOUT_UNIT]->(u)
      SET m.description = null
      RETURN count(d) AS n
    `)
    console.log(`Created ${written.records[0]?.get('n')} membership-note Descriptions.`)
  } finally {
    await session.close()
    await driver.close()
  }
}
void main().catch(e => { console.error(e); process.exit(1) })
