/**
 * Write the entity records (#273) of the bundles that were there before them: one `proposals/by-entity/<entityId>/<bundleId>.json`
 * per entity of every bundle, live or archived, from the manifests and payloads. docs/PROPOSALS.md, «Entity records».
 *
 *   npx tsx scripts/tools/backfill-entity-records.ts                   counts what it would write, changes nothing
 *   npx tsx scripts/tools/backfill-entity-records.ts --write           writes the records, then checks that none is left to write
 *   … --drop-indexes [--write]                                         then the old shared index.json files too, only when the
 *                                                                      check found none left
 *   … --production                                                     production instead of the local bucket
 *   … --to <checkout>                                                  another checkout's bucket (default: the current one)
 *
 * Locally it works on the bucket of `npm run dev:worker` (which `npm run pull:bundles` fills from production), so stop
 * dev:worker first. With --production it calls `POST /api/admin/proposals/entity-records` on SITE_URL (default
 * https://forestboys.pages.dev), which runs the same code in steps a Worker can take, until `next` is null. It signs in with
 * a ten-minute admin token signed with SESSION_SECRET from .env.production, the key the site checks bearer tokens with.
 * Safe to run again: a record that is right is left alone.
 */
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { R2Bucket } from '@cloudflare/workers-types'
import { getPlatformProxy } from 'wrangler'
import { PRODUCTION, WRITE, oldFlagsIn, productionBanner } from '../lib/env.ts'
import { backfillEntityRecords, dropOldIndexes, type BackfillResult } from '../../functions/_lib/entity-records.ts'

const old = oldFlagsIn(process.argv)
if (old.length) { console.error(`${old.join(', ')} is not a flag any more: a script is a dry run unless you pass --write.`); process.exit(2) }
const DROP = process.argv.includes('--drop-indexes')

type Counts = Omit<BackfillResult, 'next'>
interface DropResult { found: number; deleted: number }
interface Target {
  backfill(write: boolean): Promise<Counts>
  drop(write: boolean): Promise<DropResult>
  dispose(): Promise<void>
}

async function localTarget(): Promise<Target> {
  const toIndex = process.argv.indexOf('--to')
  const target = resolve(toIndex >= 0 ? process.argv[toIndex + 1] ?? '' : '.')
  if (!existsSync(join(target, 'wrangler.toml'))) { console.error(`${target} is not a checkout (no wrangler.toml).`); process.exit(2) }
  const stateDir = join(target, '.wrangler', 'state')
  console.error(`▶ LOCAL ${stateDir} ${WRITE ? '— WRITING' : '— read only'}`)
  const proxy = await getPlatformProxy<{ PROPOSALS: R2Bucket }>({ configPath: join(target, 'wrangler.toml'), persist: { path: join(stateDir, 'v3') } })
  const bucket = proxy.env.PROPOSALS
  return {
    backfill: write => backfillEntityRecords(bucket, { write }),
    drop:     write => dropOldIndexes(bucket, { write }),
    dispose:  () => proxy.dispose(),
  }
}

function productionTarget(): Target {
  // Read like pull-production-r2.ts: the shell wins, then .env.production.
  const file = existsSync('.env.production') ? readFileSync('.env.production', 'utf8') : ''
  const fromFile = (name: string) => new RegExp(`^${name}=(.+)$`, 'm').exec(file)?.[1].trim()
  const site = (process.env.SITE_URL ?? fromFile('SITE_URL') ?? 'https://forestboys.pages.dev').replace(/\/$/, '')
  const secret = process.env.SESSION_SECRET ?? fromFile('SESSION_SECRET')
  if (!secret) { console.error('SESSION_SECRET is not set (.env.production).'); process.exit(2) }
  console.error(productionBanner(new URL(site).host, WRITE))
  const token = adminToken(secret, 600)

  async function call<T>(body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${site}/api/admin/proposals/entity-records`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${res.status} ${text}`)
    return JSON.parse(text) as T
  }

  return {
    async backfill(write) {
      const sum: Counts = { bundles: 0, entities: 0, changed: 0, unchanged: 0, noPayload: 0 }
      let cursor: string | null = null
      do {
        const r: BackfillResult = await call({ write, cursor })
        for (const k of Object.keys(sum) as (keyof Counts)[]) sum[k] += r[k]
        cursor = r.next
        if (cursor) console.error(`  … ${sum.entities} entities so far, going on from ${cursor}`)
      } while (cursor)
      return sum
    },
    async drop(write) {
      // The endpoint deletes a limited number a call; go on until a call deletes the last of them.
      let found = 0, deleted = 0
      for (;;) {
        const r = await call<DropResult>({ dropIndexes: true, write })
        found ||= r.found
        deleted += r.deleted
        if (!write || r.deleted === 0 || r.found <= r.deleted) return { found, deleted }
        console.error(`  … ${deleted} of ${found} deleted`)
      }
    },
    dispose: async () => {},
  }
}

/** An HS256 token in the shape functions/_lib/jwt.ts signs and the site accepts as `Authorization: Bearer`. */
function adminToken(secret: string, ttlSeconds: number): string {
  const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url')
  const iat = Math.floor(Date.now() / 1000)
  const claims = { sub: 'script:backfill-entity-records', email: 'script@milorg.local', name: 'backfill-entity-records', role: 'admin', iat, exp: iat + ttlSeconds }
  const input = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
  return `${input}.${b64url(createHmac('sha256', secret).update(input).digest())}`
}

const describe = (r: Counts, write: boolean) =>
  `${r.bundles} bundles, ${r.entities} entities: ${r.changed} ${write ? 'written' : 'to write'}, ${r.unchanged} already right, ${r.noPayload} without a payload.`

const target = PRODUCTION ? productionTarget() : await localTarget()
try {
  const r = await target.backfill(WRITE)
  console.log(describe(r, WRITE))
  let left = r.changed
  if (WRITE) {
    const check = await target.backfill(false)
    left = check.changed
    console.log(`Check: ${left} left to write.`)
  }
  if (WRITE && left) process.exitCode = 1
  if (DROP && WRITE && left) {
    console.error('The old index.json files are kept: the check found records still to write. Run it again.')
  } else if (DROP) {
    const d = await target.drop(WRITE)
    console.log(`${d.found} old index.json files found, ${d.deleted} deleted.${!WRITE && left ? ' (With --write they go only after the records are written.)' : ''}`)
  }
  if (!WRITE) console.log('Dry run. Pass --write to write.')
} catch (e) {
  console.error((e as Error).message)
  process.exitCode = 1
} finally {
  await target.dispose()
}
