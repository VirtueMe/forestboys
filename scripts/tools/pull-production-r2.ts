/**
 * Make the local bundle store (the PROPOSALS R2 bucket) the same as production.
 *
 *   npx tsx scripts/tools/pull-production-r2.ts            counts of both, changes nothing
 *   npx tsx scripts/tools/pull-production-r2.ts --write    empties the local bucket, copies production into it
 *   … --to <checkout>                                      fills another checkout's bucket (default: the current one)
 *   … --local [--to <checkout>]                            copies the repo root's local bucket, not production's
 *   … --from <checkout> [--to <checkout>]                  copies that checkout's local bucket, not production's
 *
 * Production is only ever read, through the Cloudflare API. It needs R2_CLOUDFLARE_API_TOKEN (from the shell or
 * .env.production; a token with R2 read on the account), which this script sets as CLOUDFLARE_API_TOKEN for its own
 * run only, and the account id (CLOUDFLARE_ID in .env.production). The target is the local state of
 * `npm run dev:worker` (.wrangler/state), written through wrangler's own local binding so the format is the one the
 * dev server reads. Stop dev:worker first: two processes on the same SQLite state can corrupt it.
 *
 * --local copies from the repo's root checkout (the one the worktrees hang off) instead of from production, and
 * --from <checkout> from any checkout: no token, no network. The source can't be the target.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { R2Bucket } from '@cloudflare/workers-types'
import { getPlatformProxy } from 'wrangler'
import { WRITE, oldFlagsIn, productionBanner } from '../lib/env.ts'

const BUCKET = 'milorg-proposals'
const PREFIX = ''
const PARALLEL = 8

const old = oldFlagsIn(process.argv)
if (old.length) { console.error(`${old.join(', ')} is not a flag any more: a script is a dry run unless you pass --write.`); process.exit(2) }

function pathFlag(name: string): string | undefined {
  const i = process.argv.findIndex(a => a === name || a.startsWith(`${name}=`))
  if (i < 0) return undefined
  const v = process.argv[i].includes('=') ? process.argv[i].split('=')[1] : process.argv[i + 1]
  if (!v) { console.error(`${name} needs the path of a checkout.`); process.exit(2) }
  return v
}
function checkout(path: string): string {
  const dir = resolve(path)
  if (!existsSync(join(dir, 'wrangler.toml'))) { console.error(`${dir} is not a checkout (no wrangler.toml).`); process.exit(2) }
  return dir
}
const target = checkout(pathFlag('--to') ?? '.')
const stateDir = join(target, '.wrangler', 'state')

const fromArg = pathFlag('--from')
const LOCAL_SOURCE = process.argv.includes('--local') || fromArg !== undefined
const sourceRoot = !LOCAL_SOURCE ? '' : fromArg ? checkout(fromArg) : dirname(resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim()))
if (LOCAL_SOURCE && sourceRoot === target) { console.error(`The source and the target are both ${target}. Pass --to <checkout> or --from <checkout>.`); process.exit(2) }

const prodFile = LOCAL_SOURCE ? '' : readFileSync('.env.production', 'utf8')
const fromFile = (name: string) => new RegExp(`^${name}=(.+)$`, 'm').exec(prodFile)?.[1].trim()
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? fromFile('CLOUDFLARE_ID')
// R2_CLOUDFLARE_API_TOKEN (shell or .env.production) is the one to keep; it becomes CLOUDFLARE_API_TOKEN for this run only.
const token = process.env.R2_CLOUDFLARE_API_TOKEN ?? fromFile('R2_CLOUDFLARE_API_TOKEN') ?? process.env.CLOUDFLARE_API_TOKEN
if (token) process.env.CLOUDFLARE_API_TOKEN = token
if (!LOCAL_SOURCE) {
  if (!account) { console.error('No account id: CLOUDFLARE_ID in .env.production (or CLOUDFLARE_ACCOUNT_ID).'); process.exit(2) }
  if (!token) {
    console.error(`R2_CLOUDFLARE_API_TOKEN is not set.

  Production's bundles are read through the Cloudflare API, which needs a token that can read R2:

    1. Open https://dash.cloudflare.com/profile/api-tokens → Create Token → Create Custom Token
    2. Permission: Account → Workers R2 Storage → Read   (account resources: your account)
    3. Create it and copy the token (it is shown once)
    4. export R2_CLOUDFLARE_API_TOKEN=<token>   (or one line R2_CLOUDFLARE_API_TOKEN=<token> in .env.production)

  Then run this again. The token is used as CLOUDFLARE_API_TOKEN for this run only.`)
    process.exit(2)
  }
}

console.error(LOCAL_SOURCE ? `▶ SOURCE ${join(sourceRoot, '.wrangler', 'state')} — read only` : productionBanner(`R2 ${BUCKET}`, false))
console.error(`▶ LOCAL ${stateDir} ${WRITE ? '— WRITING (the local bucket is emptied first)' : '— read only'}`)

const api = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects`
const headers = { Authorization: `Bearer ${token}` }

interface Remote { key: string; size: number }

async function listProduction(): Promise<Remote[]> {
  const out: Remote[] = []
  let cursor: string | undefined
  for (;;) {
    const url = new URL(api)
    url.searchParams.set('per_page', '1000')
    if (PREFIX) url.searchParams.set('prefix', PREFIX)
    if (cursor) url.searchParams.set('cursor', cursor)
    const res = await fetch(url, { headers })
    const body = await res.json() as { success: boolean; errors: unknown[]; result: Remote[]; result_info?: { cursor?: string; is_truncated?: boolean } }
    if (!body.success) throw new Error(`Listing failed (${res.status}): ${JSON.stringify(body.errors)}`)
    out.push(...body.result)
    cursor = body.result_info?.cursor
    if (!body.result_info?.is_truncated || !cursor) return out
  }
}

async function download(key: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const res = await fetch(`${api}/${encodeURIComponent(key)}`, { headers })
  if (!res.ok) throw new Error(`GET ${key}: ${res.status}`)
  return { data: await res.arrayBuffer(), contentType: res.headers.get('content-type') ?? 'application/octet-stream' }
}

async function listLocal(bucket: R2Bucket): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ cursor, limit: 1000 })
    keys.push(...page.objects.map(o => o.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return keys
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

interface Source { label: string; objects: Remote[]; get(key: string): Promise<{ data: ArrayBuffer; contentType: string }>; dispose(): Promise<void> }

async function openSource(): Promise<Source> {
  if (!LOCAL_SOURCE) return { label: 'Production', objects: await listProduction(), get: download, dispose: async () => {} }
  const proxy = await openBucket(join(sourceRoot, '.wrangler', 'state'))
  const keys = await listLocal(proxy.env.PROPOSALS)
  return {
    label: 'Source',
    objects: keys.map(key => ({ key, size: 0 })),
    async get(key) {
      const obj = await proxy.env.PROPOSALS.get(key)
      if (!obj) throw new Error(`${key} vanished from the root bucket`)
      return { data: await obj.arrayBuffer(), contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream' }
    },
    dispose: () => proxy.dispose(),
  }
}

const openBucket = (state: string) => getPlatformProxy<{ PROPOSALS: R2Bucket }>({ configPath: 'wrangler.toml', persist: { path: join(state, 'v3') } })

const progress = (done: number, total: number) => { if (process.stderr.isTTY) process.stderr.write(`\r  copied ${done}/${total}`) }

const source = await openSource()
const proxy = await openBucket(stateDir)
try {
  const bucket = proxy.env.PROPOSALS
  const local = await listLocal(bucket)
  const bundles = (keys: string[]) => new Set(keys.map(k => /^proposals\/bundles\/([^/]+)\//.exec(k)?.[1]).filter(Boolean)).size
  console.log(`${source.label}:${' '.repeat(Math.max(1, 11 - source.label.length))}${source.objects.length} objects, ${bundles(source.objects.map(o => o.key))} bundles`)
  console.log(`Local:      ${local.length} objects, ${bundles(local)} bundles`)
  if (!WRITE) { console.log(`Dry run. Pass --write to empty the local bucket and copy ${source.label.toLowerCase()}'s into it.`); process.exit(0) }

  for (let i = 0; i < local.length; i += 1000) await bucket.delete(local.slice(i, i + 1000))
  let done = 0
  await pool(source.objects, async ({ key }) => {
    const { data, contentType } = await source.get(key)
    await bucket.put(key, data, { httpMetadata: { contentType } })
    progress(++done, source.objects.length)
  })
  if (process.stderr.isTTY) process.stderr.write('\n')

  const after = await listLocal(bucket)
  console.log(`Copied ${done} objects; local now has ${after.length}.`)
  if (after.length !== source.objects.length) { console.error('The counts differ.'); process.exitCode = 1 }
} finally {
  await proxy.dispose()
  await source.dispose()
}
