/**
 * Slug review list for Sanity `transport` documents. Read-only.
 *
 * Slugs were typed by hand in Sanity and drift from the name: some are cut
 * short, some carry a typo, and in some the *name* was corrected later while
 * the slug kept the old spelling. Which side is right is Jan's call, so this
 * only lists candidates — nothing here renames anything.
 *
 * Renaming a slug waits for #96 (aliases, reference rewrite, 302 redirect):
 * a bare `SET n.slug` leaves dead links. When #96 is in, this list is the
 * input for a rename bundle.
 *
 *   same        slug is the slugified (tidied) name
 *   shortened   slug is a leading part of the slugified name (cut by hand)
 *   differs     slug and name disagree — either may be the typo
 *   malformed   slug holds characters outside [a-z0-9-]
 *
 * Output: data/sanity-delta/transport-slugs.json + a summary.
 *
 * Usage: npx tsx scripts/sanity/sanity-transport-slugs.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { API, type Doc } from '../lib/person-sync.ts'
import { slugify, SLUG_RE } from '../../src/utils/slug.ts'
import { tidyText } from '../../src/utils/tidyText.ts'

const OUT_DIR = resolve(process.cwd(), 'data', 'sanity-delta')

type Kind = 'same' | 'shortened' | 'differs' | 'malformed'

interface Row { sanityId: string; slug: string; nameSlug: string; name: string; regser: string | null; kind: Kind }

async function fetchTransports(): Promise<Doc[]> {
  const url = new URL(API)
  url.searchParams.set('query',
    `*[_type == "transport" && !(_id in path("drafts.**"))]{_id, name, regser, "slug": slug.current} | order(_id asc)`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sanity ${res.status}`)
  return (await res.json() as { result: Doc[] }).result
}

function classify(slug: string, nameSlug: string): Kind {
  if (!SLUG_RE.test(slug) || slug.startsWith('-') || slug.endsWith('-')) return 'malformed'
  if (slug === nameSlug) return 'same'
  if (nameSlug.startsWith(slug)) return 'shortened'
  return 'differs'
}

async function main() {
  const docs = await fetchTransports()
  const rows: Row[] = docs.map(d => {
    const name = tidyText(d.name as string) ?? ''
    const slug = typeof d.slug === 'string' ? d.slug : ''
    const nameSlug = slugify(name)
    return {
      sanityId: d._id, slug, nameSlug, name,
      regser: tidyText(d.regser as string), kind: classify(slug, nameSlug),
    }
  })

  const tally: Record<Kind, number> = { same: 0, shortened: 0, differs: 0, malformed: 0 }
  for (const r of rows) tally[r.kind]++
  const review = rows.filter(r => r.kind !== 'same')

  mkdirSync(OUT_DIR, { recursive: true })
  const file = resolve(OUT_DIR, 'transport-slugs.json')
  writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), tally, review }, null, 2))

  console.log(`Transports in Sanity: ${rows.length}`)
  console.log(`  same ${tally.same} · shortened ${tally.shortened} · differs ${tally.differs} · malformed ${tally.malformed}`)
  console.log(`Review list (${review.length}) → ${file}`)
  for (const r of review.filter(r => r.kind === 'malformed')) console.log(`  malformed: ${JSON.stringify(r.slug)} (${r.name})`)
}

main().catch(e => { console.error(e); process.exit(1) })
