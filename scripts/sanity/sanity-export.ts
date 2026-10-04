/**
 * Export all Sanity documents to data/sanity-{type}.json files.
 * Run with: npx tsx scripts/sanity-export.ts
 *
 * Safe to re-run — overwrites existing files.
 * Output directory (data/) is gitignored.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const PROJECT_ID = '7r6kqtqy'
const DATASET    = 'production'
const CDN        = `https://${PROJECT_ID}.apicdn.sanity.io/v2021-08-31/data/query/${DATASET}`
const OUT_DIR    = resolve(process.cwd(), 'data')

const TYPES = [
  'airfield',
  'district',
  'event',
  'location',
  'organization',
  'outline',
  'partner',
  'person',
  'station',
  'transport',
]

async function fetchAll<T>(type: string): Promise<T[]> {
  let results: T[] = []
  let lastId = ''
  const pageSize = 500
  const query = `*[_type == "${type}"]`

  while (true) {
    const filter = lastId
      ? `*[_type == "${type}" && _id > "${lastId}"]`
      : query
    const paginated = `${filter} | order(_id asc) [0...${pageSize}]`
    const url = `${CDN}?query=${encodeURIComponent(paginated)}`
    const res  = await fetch(url)
    if (!res.ok) throw new Error(`Sanity fetch failed for ${type}: ${res.status}`)
    const json = await res.json() as { result: T[] }
    const page = json.result ?? []
    results = results.concat(page)
    if (page.length < pageSize) break
    lastId = (page[page.length - 1] as Record<string, unknown>)['_id'] as string
    process.stdout.write('.')
  }

  return results
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const summary: { type: string; count: number; file: string }[] = []

  for (const type of TYPES) {
    process.stdout.write(`Fetching ${type}…`)
    const docs = await fetchAll(type)
    process.stdout.write(` ${docs.length}\n`)

    const file = resolve(OUT_DIR, `sanity-${type}.json`)
    writeFileSync(file, JSON.stringify(docs, null, 2) + '\n')

    summary.push({ type, count: docs.length, file: `data/sanity-${type}.json` })
  }

  console.log('\nExport complete:')
  for (const { type, count, file } of summary) {
    console.log(`  ${type.padEnd(14)} ${String(count).padStart(5)} docs  →  ${file}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
