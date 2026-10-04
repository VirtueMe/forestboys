/**
 * One small write, so an Aura Free instance doesn't pause (and later get
 * deleted) for inactivity. The daily sync job runs it last, whatever the
 * syncs did — a sync that refuses to write mustn't let the instance lapse.
 *
 *   (:Heartbeat {id: 'daily'}) — at, runs
 *
 * Usage: npx tsx scripts/heartbeat.ts [--production] --write
 */

import { loadEnv } from '../lib/env.ts'
import { neo4jDriver } from '../lib/person-sync.ts'
loadEnv()

if (!process.argv.includes('--write')) {
  console.log('(dry run — pass --write to write the heartbeat)')
  process.exit(0)
}

const driver = neo4jDriver()
const session = driver.session()
try {
  const r = await session.run(`
    MERGE (h:Heartbeat {id: 'daily'})
    SET h.at = datetime(), h.runs = coalesce(h.runs, 0) + 1
    RETURN toString(h.at) AS at, h.runs AS runs`)
  console.log(`Heartbeat ${r.records[0].get('at')} (run ${r.records[0].get('runs')})`)
} finally {
  await session.close()
  await driver.close()
}
