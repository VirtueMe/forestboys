/**
 * Add order=1 to every existing Description that doesn't have one.
 * Idempotent — safe to re-run. Next slice allows multiple Descriptions
 * per Card, ordered by this field.
 */

import neo4j from 'neo4j-driver'
import * as dotenv from 'dotenv'
dotenv.config()

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
  )
  const session = driver.session()
  try {
    const r = await session.run(`
      MATCH (d:Description)
      WHERE d.order IS NULL
      SET d.order = 1
      RETURN count(d) AS updated
    `)
    console.log(`Updated ${r.records[0]?.get('updated')} Description nodes.`)
  } finally {
    await session.close()
    await driver.close()
  }
}
void main().catch(e => { console.error(e); process.exit(1) })
