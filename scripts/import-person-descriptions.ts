/**
 * Import Sanity person descriptions into the graph (docs/SANITY-SYNC.md).
 * They were never imported: the Person page showed them from the Sanity
 * cache, so Sanity held the only copy.
 *
 * Per person, one section, in the shape the editor writes
 * (functions/api/admin/person/[slug]/sections.ts):
 *
 *   (Person)-[:HAS_CONTENT]->(Description {id: 'desc:person:<slug>:1', order: 1, content})
 *
 * `content` is Sanity's Portable Text blocks as-is. Provenance goes on the
 * Person, following its existing per-field pattern (home_sourceRef, …):
 *
 *   description_sourceRef        'sanity-migration:person:<sanityId>:description'
 *   description_state            'candidate'
 *   description_sanityUpdatedAt  the document's _updatedAt
 *   description_sha              sha256 of the imported blocks (stable JSON)
 *
 * The sha is what the sync compares against: Sanity changed the description
 * when its blocks no longer hash to it; Jan edited it in the graph when the
 * stored content no longer does.
 *
 * - Reads current Sanity (api.sanity.io), not an export.
 * - Skips: people not in the graph (they come with the new-person import),
 *   descriptions with no text, and any Person that already has HAS_CONTENT
 *   (never overwrites graph-authored text). Skips are reported.
 * - Idempotent: a Person with description_sourceRef is skipped.
 *
 * Usage: npx tsx scripts/import-person-descriptions.ts [--write]
 */

import neo4j from 'neo4j-driver'
import { loadEnv } from './lib/env.ts'
import { fieldSha } from './lib/sanity-sha.ts'
loadEnv()

const API   = 'https://7r6kqtqy.api.sanity.io/v2021-08-31/data/query/production'
const write = process.argv.includes('--write')
const BATCH = 250

interface Doc { _id: string; _updatedAt: string; description?: unknown }

function hasText(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false
  return blocks.some(b => ((b as { children?: { text?: string }[] }).children ?? []).some(c => (c.text ?? '').trim()))
}

async function fetchDescriptions(): Promise<Doc[]> {
  const out: Doc[] = []
  let lastId = ''
  for (;;) {
    const url = new URL(API)
    url.searchParams.set('query',
      `*[_type == "person" && !(_id in path("drafts.**")) && _id > $lastId && defined(description)]
         | order(_id asc) [0...1000] { _id, _updatedAt, description }`)
    url.searchParams.set('$lastId', JSON.stringify(lastId))
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Sanity ${res.status}`)
    const page = (await res.json() as { result: Doc[] }).result
    out.push(...page)
    if (page.length < 1000) return out
    lastId = page[page.length - 1]._id
  }
}

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
  )
  const session = driver.session()
  try {
    const docs = await fetchDescriptions()
    const r = await session.run(`
      MATCH (p:Person) WHERE p.sanityId IS NOT NULL
      RETURN p.sanityId AS id, p.slug AS slug,
             p.description_sourceRef IS NOT NULL AS imported,
             EXISTS { (p)-[:HAS_CONTENT]->(:Description) } AS hasContent`)
    const people = new Map(r.records.map(rec => [rec.get('id') as string, {
      slug: rec.get('slug') as string,
      imported: rec.get('imported') as boolean,
      hasContent: rec.get('hasContent') as boolean,
    }]))

    const skip = { notInGraph: 0, noText: 0, alreadyImported: 0, graphAuthored: [] as string[] }
    const items: Record<string, unknown>[] = []
    for (const d of docs) {
      const p = people.get(d._id)
      if (!p)                    { skip.notInGraph++; continue }
      if (!hasText(d.description)) { skip.noText++; continue }
      if (p.imported)            { skip.alreadyImported++; continue }
      if (p.hasContent)          { skip.graphAuthored.push(p.slug); continue }
      items.push({
        slug:      p.slug,
        id:        `desc:person:${p.slug}:1`,
        content:   JSON.stringify(d.description),
        sourceRef: `sanity-migration:person:${d._id}:description`,
        updatedAt: d._updatedAt,
        sha:       fieldSha(d.description),
      })
    }

    console.log(`Sanity people with a description field: ${docs.length}`)
    console.log(`  to import:            ${items.length}`)
    console.log(`  not in graph yet:     ${skip.notInGraph}`)
    console.log(`  no text:              ${skip.noText}`)
    console.log(`  already imported:     ${skip.alreadyImported}`)
    console.log(`  written in the graph: ${skip.graphAuthored.length}${skip.graphAuthored.length ? ` (${skip.graphAuthored.join(', ')})` : ''}`)

    if (!write) { console.log('\n(dry run — pass --write to import)'); return }

    let created = 0
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH)
      const res = await session.executeWrite(tx => tx.run(`
        UNWIND $batch AS it
        MATCH (p:Person {slug: it.slug})
        WHERE p.description_sourceRef IS NULL AND NOT EXISTS { (p)-[:HAS_CONTENT]->(:Description) }
        CREATE (p)-[:HAS_CONTENT]->(:Description {id: it.id, order: 1, content: it.content})
        SET p.description_sourceRef       = it.sourceRef,
            p.description_state           = 'candidate',
            p.description_sanityUpdatedAt = it.updatedAt,
            p.description_sha             = it.sha
        RETURN count(*) AS n
      `, { batch }))
      const n = res.records[0].get('n').toNumber() as number
      created += n
      if (n !== batch.length) {
        console.error(`Batch at ${i}: created ${n} of ${batch.length} — stopping.`)
        process.exitCode = 1
        return
      }
    }
    console.log(`\nCreated ${created} descriptions.`)
  } finally {
    await session.close()
    await driver.close()
  }
}
void main().catch(e => { console.error(e); process.exit(1) })
