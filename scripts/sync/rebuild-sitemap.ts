/**
 * Ask the site to rebuild its list of pages (sitemap.txt and the 404 check, #220). The sync writes to the graph
 * directly, so the site does not know a page appeared or went; the daily job runs this last.
 *
 *   SITE_URL            the site's address, e.g. https://forestboys.pages.dev
 *   BOT_INGEST_SECRET   the same secret the Pages project has
 *
 * Usage: npx tsx scripts/sync/rebuild-sitemap.ts --write
 */

import { createHmac } from 'node:crypto'
import { loadEnv } from '../lib/env.ts'
loadEnv()

if (!process.argv.includes('--write')) {
  console.log('(dry run — pass --write to rebuild the sitemap)')
  process.exit(0)
}

const site = process.env.SITE_URL?.replace(/\/$/, '')
const secret = process.env.BOT_INGEST_SECRET
if (!site || !secret) {
  console.error('SITE_URL and BOT_INGEST_SECRET are required')
  process.exit(1)
}

const res = await fetch(`${site}/api/sitemap/rebuild`, {
  method: 'POST',
  headers: { 'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', secret).update('').digest('hex') },
})
const text = await res.text()
if (!res.ok) {
  console.error(`Rebuild failed: ${res.status} ${text}`)
  process.exit(1)
}
console.log(`Sitemap rebuilt: ${text}`)
