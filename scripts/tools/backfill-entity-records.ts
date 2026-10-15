/**
 * Write the entity records (#273) of the bundles that were there before them: one `proposals/by-entity/<entityId>/<bundleId>.json`
 * per entity of every bundle, live or archived, from the manifests and payloads. docs/PROPOSALS.md, «Entity records».
 *
 *   npx tsx scripts/tools/backfill-entity-records.ts                   counts what it would write, changes nothing
 *   npx tsx scripts/tools/backfill-entity-records.ts --write           writes the records
 *   … --drop-indexes [--write]                                         the old shared index.json files instead
 *   … --to <checkout>                                                  another checkout's bucket (default: the current one)
 *
 * It works on the local bucket (the state of `npm run dev:worker`, which `npm run pull:bundles` fills from production), so
 * stop dev:worker first. Production is done by the admin endpoint `POST /api/admin/proposals/entity-records`, which runs the
 * same code in steps a Worker can take. Safe to run again: a record that is right is left alone.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { R2Bucket } from '@cloudflare/workers-types'
import { getPlatformProxy } from 'wrangler'
import { WRITE, oldFlagsIn } from '../lib/env.ts'
import { backfillEntityRecords, dropOldIndexes } from '../../functions/_lib/entity-records.ts'

const old = oldFlagsIn(process.argv)
if (old.length) { console.error(`${old.join(', ')} is not a flag any more: a script is a dry run unless you pass --write.`); process.exit(2) }

const toIndex = process.argv.indexOf('--to')
const target = resolve(toIndex >= 0 ? process.argv[toIndex + 1] ?? '' : '.')
if (!existsSync(join(target, 'wrangler.toml'))) { console.error(`${target} is not a checkout (no wrangler.toml).`); process.exit(2) }
const stateDir = join(target, '.wrangler', 'state')

console.error(`▶ LOCAL ${stateDir} ${WRITE ? '— WRITING' : '— read only'}`)
const proxy = await getPlatformProxy<{ PROPOSALS: R2Bucket }>({ configPath: join(target, 'wrangler.toml'), persist: { path: join(stateDir, 'v3') } })
try {
  const bucket = proxy.env.PROPOSALS
  if (process.argv.includes('--drop-indexes')) {
    const r = await dropOldIndexes(bucket, { write: WRITE })
    console.log(`${r.found} old index.json files found, ${r.deleted} deleted.`)
  } else {
    const r = await backfillEntityRecords(bucket, { write: WRITE })
    console.log(`${r.bundles} bundles, ${r.entities} entities: ${r.changed} ${WRITE ? 'written' : 'to write'}, ${r.unchanged} already right, ${r.noPayload} without a payload.`)
  }
  if (!WRITE) console.log('Dry run. Pass --write to write.')
} finally {
  await proxy.dispose()
}
