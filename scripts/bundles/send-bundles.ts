/**
 * Send bundle files (the ones `scripts/migrations/outlines-to-bundles.ts` or `package-to-bundle.ts` wrote) to a
 * site's ingest, signed as the bot signs (HMAC-SHA256 of the raw body, `X-Hub-Signature-256`), so they land in R2 and
 * Jan can review them. Ingest takes them as they are (docs/BUNDLE-FORMAT.md).
 *
 *   npx tsx scripts/bundles/send-bundles.ts --dir=data/outlines-conversion-production/bundles \
 *       --url=https://forestboys.pages.dev/api/proposals/ingest --production [--again] [--write]
 *
 * A dry run unless --write: it checks every file against what ingest checks and says what it would send. The secret is
 * `BOT_INGEST_SECRET`, from `.env.production` with --production (a localhost url, without it, reads `.env`). A bundle is sent once: a `sent.json`
 * beside the files lists what went, and a second send of the same bundle id would put its entities back to pending,
 * so it is refused unless --again. Sending stops at the first failure.
 */

import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validateBundle, type IngestBody } from '../../functions/_lib/bundle-validate.ts'
import { loadEnv, WRITE } from '../lib/env.ts'

// Reads `.env`, or `.env.production` with --production (scripts/lib/env.ts), which also prints the banner.
const { production } = loadEnv()

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const AGAIN = process.argv.includes('--again')

const dir = arg('dir'), url = arg('url')
if (!dir || !url || !/^https?:\/\/\S+\/api\/proposals\/ingest$/.test(url)) {
  console.error('--dir=<a folder of bundle files> and --url=<https://…/api/proposals/ingest> are required'); process.exit(2)
}
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)
// The secret and the site go together: a production secret is never sent to localhost, a local one never to a site.
if (!local && !production) { console.error('that url is not localhost: pass --production, so the production secret is the one used'); process.exit(2) }
if (local && production)   { console.error('--production with a localhost url: leave --production out'); process.exit(2) }
const secret = process.env.BOT_INGEST_SECRET
if (!secret) { console.error(`BOT_INGEST_SECRET is not set in ${production ? '.env.production' : '.env'}`); process.exit(2) }

const folder = resolve(dir)
const sentFile = join(folder, 'sent.json')
const sent: Record<string, string> = existsSync(sentFile) ? JSON.parse(readFileSync(sentFile, 'utf8')) as Record<string, string> : {}
const files = readdirSync(folder).filter(f => f.endsWith('.json') && f !== 'sent.json').sort()
if (!files.length) { console.error(`no bundle files in ${folder}`); process.exit(2) }

const bundles = files.map(f => ({ file: f, raw: readFileSync(join(folder, f), 'utf8') }))
let bad = 0
for (const b of bundles) {
  const checked = validateBundle(JSON.parse(b.raw) as IngestBody)
  if (typeof checked === 'string') { console.error(`${b.file}: ingest would refuse it: ${checked}`); bad++ }
}
if (bad) process.exit(1)

console.log(`\n${bundles.length} bundles in ${folder}, to ${url}${local ? '' : ' (not local)'}`)
for (const b of bundles) {
  const id = (JSON.parse(b.raw) as { bundleId: string }).bundleId
  console.log(`  ${b.file.padEnd(48)} ${sent[id] ? `already sent ${sent[id]}` : 'not sent'}`)
}
const already = bundles.filter(b => sent[(JSON.parse(b.raw) as { bundleId: string }).bundleId])
if (already.length && !AGAIN) { console.error(`\n${already.length} already sent: a second send resets the entities to pending. Pass --again if that is meant.`); process.exit(1) }
if (!WRITE) { console.log('\n(dry run — pass --write to send them)'); process.exit(0) }

for (const b of bundles) {
  const id = (JSON.parse(b.raw) as { bundleId: string }).bundleId
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(b.raw).digest('hex')}`, 'User-Agent': 'milorg-send-bundles/1.0' },
    body:    b.raw,
  })
  const text = await resp.text()
  if (!resp.ok) { console.error(`\n${b.file}: ${resp.status} ${text}\nStopped; ${Object.keys(sent).length} sent so far.`); process.exit(1) }
  sent[id] = new Date().toISOString()
  writeFileSync(sentFile, `${JSON.stringify(sent, null, 2)}\n`)
  const r = JSON.parse(text) as { status?: string; unresolvedRefs?: string[] }
  console.log(`  sent ${b.file}: ${r.status ?? 'ok'}${r.unresolvedRefs?.length ? `, ${r.unresolvedRefs.length} unresolved refs (blocked until their bundles are accepted)` : ''}`)
}
console.log('\nAll sent.')
