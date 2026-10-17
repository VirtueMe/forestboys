/**
 * Apply the Sanity → graph sync of an outline's node (#301, part of #156): a node for an outline new in Sanity, its title,
 * the people it mentions and its gallery. The text and the links are synced by sync-description.ts and sync-link.ts
 * (`--type=outline`). The rules are in scripts/lib/outline-sync.ts and docs/SANITY-SYNC.md («Outlines»).
 *
 * It decides nothing about what goes into the graph from an outline, and requests no bundle: an outline whose text
 * changed is `stale` (functions/_lib/outline-version.ts) and the admin's «request a bundle» makes the new one.
 *
 * Per field, against its `<field>_sha` stamp:
 *   clean       → Sanity's value is applied; the stamp moves (people: the missing mentions are added, none removed)
 *   already     → only the stamp moves
 *   conflict    → left alone, listed (Sanity changed and the graph value was edited)
 *   review      → left alone, listed (no stamp, no baseline); `--accept-review` is not offered: use the April export
 * Graph edits are never overwritten. Nodes with no Sanity document are listed, not touched. The Linge members outline is
 * left alone (LEFT_ALONE).
 *
 * Before writing, the nodes it will change are saved to data/sanity-delta/outline-before-<time>.json.
 *
 * Usage: npx tsx scripts/sync/sync-outline.ts [--production] [--write]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import { connectNeo4j } from '../lib/person-sync.ts'
import { loadBaselineFile } from '../lib/baseline.ts'
import { preformattedFromSanity } from '../lib/preformatted-blocks.ts'
import {
  APPLY_QUERY, BACKUP_QUERY, CREATE_QUERY, GALLERY_QUERY, GRAPH_QUERY, LEFT_ALONE, MENTIONS_QUERY, PEOPLE_QUERY, SLUGS_QUERY,
  classifyOutline, fetchSanityOutlines, newOutlineProps, planOutline, sanityImages, sanityPeople, sanitySlug, sanityTitle,
  type GraphOutline, type OutlineFieldName, type OutlineRow, type OutlineVerdict,
} from '../lib/outline-sync.ts'
loadEnv()

const write = process.argv.includes('--write')
const BATCH = 50
const OUT = resolve(process.cwd(), 'data', 'sanity-delta')
const SLUG_RE = /^[a-z0-9-]+$/
const asInt = (v: unknown): number => (neo4j.isInt(v) ? v.toNumber() : (v as number))

async function main() {
  const driver = await connectNeo4j()
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  const errors: string[] = []
  try {
    const baseline = loadBaselineFile(resolve(process.cwd(), 'data', 'sanity-baseline-2026-04', 'sanity-outline.json'))
    const docs = await fetchSanityOutlines()
    const graph = new Map<string, GraphOutline>((await read.run(GRAPH_QUERY)).records.map(r => {
      const o = r.toObject()
      const stamps = Object.fromEntries(Object.entries(o.stamps as Record<string, string | null>).filter(([, v]) => v))
      return [o.sanityId as string, { ...o, stamps } as GraphOutline]
    }))
    const known = new Set((await read.run(PEOPLE_QUERY)).records.map(r => r.get('id') as string))
    const taken = new Set((await read.run(SLUGS_QUERY)).records.map(r => r.get('slug') as string))
    const sanity = new Map(docs.map(d => [d._id, d]))

    // Changed in Sanity (or not stamped yet).
    const count: Partial<Record<OutlineFieldName, Record<OutlineVerdict, number>>> = {}
    const held: string[] = [], skipped: string[] = []
    const rows: OutlineRow[] = []
    for (const g of graph.values()) {
      const s = sanity.get(g.sanityId)
      if (!s) continue
      if (LEFT_ALONE.has(g.sanityId)) { skipped.push(`${g.slug} (${LEFT_ALONE.get(g.sanityId)})`); continue }
      const verdicts = classifyOutline(g, s, known, baseline.get(g.sanityId))
      for (const v of verdicts) (count[v.field] ??= { clean: 0, already: 0, conflict: 0, review: 0 })[v.verdict]++
      const row = planOutline(g, s, verdicts, known, held)
      if (row) rows.push(row)
    }

    // New in Sanity.
    const created = docs.filter(d => !graph.has(d._id) && !LEFT_ALONE.has(d._id))
    const used = new Set(taken)
    for (const d of created) {
      const slug = sanitySlug(d)
      if (!slug) errors.push(`no slug: ${d._id}`)
      else if (!SLUG_RE.test(slug)) errors.push(`odd slug: ${slug}`)
      else if (used.has(slug)) errors.push(`slug taken: ${slug} (new ${d._id})`)
      used.add(slug)
    }
    const deleted = [...graph.values()].filter(g => !sanity.has(g.sanityId))
    const missingPeople = (d: typeof docs[number]) =>
      new Set(((d.people as { _ref?: string }[] | undefined) ?? []).map(r => r?._ref ?? '').filter(Boolean)).size - sanityPeople(d, known).length

    // ── Report ──
    const stampOnly = rows.filter(r => !Object.keys(r.props).length && !r.people && !r.gallery).length
    console.log(`Outline: ${docs.length} in Sanity, ${graph.size} in the graph`)
    console.log(`To write: ${rows.length - stampOnly} node(s) with values, ${stampOnly} stamp only (${rows.filter(r => r.people).length} with mentions, ${rows.filter(r => r.gallery).length} with a gallery)`)
    for (const [f, v] of Object.entries(count)) console.log(`  ${f.padEnd(8)} ${Object.entries(v).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
    console.log(`New in Sanity: ${created.length}`)
    for (const d of created) console.log(`  + ${sanitySlug(d)} — «${sanityTitle(d)}» (${sanityPeople(d, known).length} mentions, ${sanityImages(d).length} images)`)
    for (const k of skipped) console.log(`Skipped: ${k}`)
    const unknown = docs.reduce((n, d) => n + missingPeople(d), 0)
    if (unknown) console.log(`People Sanity names that the graph does not have: ${unknown} (skipped; they join when the person is in the graph)`)
    console.log(`No Sanity document for ${deleted.length} node(s)${deleted.length ? `: ${deleted.map(g => g.slug).join(', ')}` : ''}`)
    console.log(`Left alone: ${held.length} field(s)`)
    for (const h of held.slice(0, 30)) console.log(`  ${h}`)
    if (errors.length) console.log(`\nErrors (${errors.length}):\n  ${errors.join('\n  ')}`)

    mkdirSync(OUT, { recursive: true })
    writeFileSync(resolve(OUT, 'outline-sync-plan.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), counts: count, errors, held, skipped,
      rows: rows.map(r => ({ slug: r.slug, props: r.props, people: r.people?.length ?? null, gallery: r.gallery?.length ?? null })),
      created: created.map(d => ({ slug: sanitySlug(d), title: sanityTitle(d) })), noSanityDocument: deleted.map(g => g.slug),
    }, null, 2) + '\n')

    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }
    if (errors.length) { console.error('\nRefusing to write: there are errors.'); process.exitCode = 1; return }
    if (!rows.length && !created.length) { console.log('\nNothing to write.'); return }

    // ── Backup ──
    const snap = (await read.run(BACKUP_QUERY, { ids: rows.map(r => r.id) })).records.map(r => r.toObject())
    const file = resolve(OUT, `outline-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify({ created: created.map(d => d._id), nodes: snap }) + '\n')
    console.log(`\nBackup of ${snap.length} nodes: ${file}`)

    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    try {
      const run = async (query: string, batch: Record<string, unknown>[], what: string) => {
        for (let i = 0; i < batch.length; i += BATCH) {
          const part = batch.slice(i, i + BATCH)
          const n = asInt((await ws.executeWrite(tx => tx.run(query, { rows: part }))).records[0].get('n'))
          if (n !== part.length) throw new Error(`${what} batch at ${i}: ${n} of ${part.length} nodes matched — stopping`)
        }
      }
      await run(APPLY_QUERY, rows.map(r => ({ id: r.id, props: r.props, stamps: r.stamps })), 'apply')
      await run(CREATE_QUERY, created.map(d => ({
        props: newOutlineProps(d, known), descId: `desc:Outline:${sanitySlug(d)}:1`,
        content: JSON.stringify(Array.isArray(d.description) ? preformattedFromSanity(d.description) : []),
      })), 'create')
      const people = [
        ...rows.filter(r => r.people).map(r => ({ id: r.id, people: r.people })),
        ...created.map(d => ({ id: d._id, people: sanityPeople(d, known) })).filter(r => r.people.length),
      ]
      await run(MENTIONS_QUERY, people, 'mentions')
      const galleries = [
        ...rows.filter(r => r.gallery).map(r => ({ id: r.id, images: r.gallery })),
        ...created.map(d => ({ id: d._id, images: sanityImages(d) })).filter(g => g.images.length),
      ]
      await run(GALLERY_QUERY, galleries, 'gallery')
      const newest = docs.map(d => d._updatedAt).reduce((a, b) => (b > a ? b : a), '')
      await ws.run(`MERGE (s:SyncState {source: 'sanity', type: 'outline'}) SET s.importedUpTo = $newest, s.at = datetime()`, { newest })
      console.log(`Applied: ${rows.length} node(s), ${created.length} created, ${people.length} with mentions, ${galleries.length} galleries. SyncState outline.importedUpTo = ${newest}`)
    } finally { await ws.close() }
  } finally {
    await read.close()
    await driver.close()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
