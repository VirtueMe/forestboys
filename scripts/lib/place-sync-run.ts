/**
 * The run of a place sync (#155): what scripts/sync/sync-location.ts and sync-station.ts do, for their kind. The rules
 * are in scripts/lib/place-sync.ts.
 *
 * A dry run unless --write. It prints what it would change and writes the plan to data/sanity-delta/<kind>-sync-plan.json;
 * before a write it saves the nodes it will change (properties and images) to data/sanity-delta/<kind>-before-<time>.json.
 * Graph edits are never overwritten; a slug Sanity renamed is renamed with the old one kept as an alias; a document new in
 * Sanity gets a node; a node with no Sanity document is listed, not touched. It refuses to write while there are errors
 * (a slug taken or malformed, a document with no name).
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { connectNeo4j } from './person-sync.ts'
import {
  applyQuery, backupQuery, classifyPlace, createQuery, fetchSanityPlaces, galleryQuery, graphQuery, newPlaceProps,
  planPlace, renamePhaseQuery, sanityImages, sanitySlug, sanityValue, slugsQuery,
  type FieldVerdict, type GraphPlace, type PlaceFieldName, type PlaceKind, type PlacePlan, type PlaceVerdict,
} from './place-sync.ts'
import { renameAliases, dropShadowedAliases } from '../../functions/_lib/slug-alias-cypher.ts'
import { loadBaselineFile } from './baseline.ts'

const BATCH = 100
const OUT = resolve(process.cwd(), 'data', 'sanity-delta')
const SLUG_RE = /^[a-z0-9-]+$/
/** The export the graph was imported from (local only; CI goes by the stamps). */
const baselinePath = (kind: PlaceKind) => resolve(process.cwd(), 'data', 'sanity-baseline-2026-04', `sanity-${kind.key}.json`)

const asInt = (v: unknown): number => (neo4j.isInt(v) ? v.toNumber() : (v as number))

/** `--accept-review` for one place: its review fields applied as clean ones. */
const accepted = (verdicts: FieldVerdict[], slug: string, accept: Set<string>): FieldVerdict[] =>
  verdicts.map(v => v.verdict === 'review' && accept.has(slug) ? { ...v, verdict: 'clean' as const } : v)

export async function runPlaceSync(kind: PlaceKind, argv: readonly string[]): Promise<void> {
  const write = argv.includes('--write')
  const accept = new Set((argv.find(a => a.startsWith('--accept-review='))?.slice('--accept-review='.length) ?? '')
    .split(',').map(x => x.trim()).filter(Boolean))

  const driver = await connectNeo4j()
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  const errors: string[] = []
  try {
    // Sanity in parallel with the graph; one session runs one query at a time.
    const [docs, [graphRows, slugRows]] = await Promise.all([
      fetchSanityPlaces(kind),
      (async () => [await read.run(graphQuery(kind)), await read.run(slugsQuery(kind))] as const)(),
    ])
    const graph = new Map<string, GraphPlace>(graphRows.records.map(r => {
      const o = r.toObject()
      const stamps = Object.fromEntries(Object.entries(o.stamps as Record<string, string | null>).filter(([, v]) => v))
      return [o.sanityId as string, { ...o, stamps } as GraphPlace]
    }))
    const sanity = new Map(docs.map(d => [d._id, d]))
    const baseline = loadBaselineFile(baselinePath(kind))

    // Changed in Sanity (or not stamped yet).
    const count: Partial<Record<PlaceFieldName, Record<PlaceVerdict, number>>> = {}
    const plan: PlacePlan = { rows: [], galleries: [], renames: [], held: [] }
    const withReview = new Set<string>()
    for (const g of graph.values()) {
      const s = sanity.get(g.sanityId)
      if (!s) continue
      const verdicts = classifyPlace(kind, g, s, baseline.get(g.sanityId))
      for (const v of verdicts) (count[v.field] ??= { clean: 0, already: 0, conflict: 0, kept: 0, review: 0 })[v.verdict]++
      if (verdicts.some(v => v.verdict === 'review')) withReview.add(g.slug)
      planPlace(kind, g, s, accepted(verdicts, g.slug, accept), plan)
    }
    for (const slug of accept) if (!withReview.has(slug)) errors.push(`--accept-review: ${slug} has no review fields`)

    // New in Sanity, and the slugs as they will be after the run: one page per slug.
    const created = docs.filter(d => !graph.has(d._id))
    const owner = new Map<string, string>()   // slug → sanityId (or the slug itself for a node not from Sanity)
    const renamed = new Map(plan.renames.map(r => [r.id, r.to]))
    for (const r of slugRows.records) {
      const id = (r.get('sanityId') as string | null) ?? `graph:${r.get('slug') as string}`
      const slug = renamed.get(id) ?? (r.get('slug') as string)
      if (owner.has(slug) && owner.get(slug) !== id) errors.push(`slug used twice after the run: ${slug}`)
      owner.set(slug, id)
    }
    for (const d of created) {
      const slug = sanitySlug(d)
      if (!slug) { errors.push(`no slug: ${d._id}`); continue }
      if (owner.has(slug)) errors.push(`slug taken: ${slug} (new ${d._id})`)
      owner.set(slug, d._id)
      if (!sanityValue(d, 'name')) errors.push(`no name: ${slug}`)
    }
    for (const r of plan.renames) if (!SLUG_RE.test(r.to)) errors.push(`odd slug: ${r.from} → ${r.to}`)
    for (const d of created) if (sanitySlug(d) && !SLUG_RE.test(sanitySlug(d))) errors.push(`odd slug: new ${sanitySlug(d)}`)
    const deleted = [...graph.values()].filter(g => !sanity.has(g.sanityId))

    // ── Report ──
    const stampOnly = plan.rows.filter(r => !Object.keys(r.props).length).length
    console.log(`${kind.label}: ${docs.length} in Sanity, ${graph.size} in the graph`)
    console.log(`To write: ${plan.rows.length - stampOnly} node(s) with values, ${stampOnly} stamp only, ${plan.galleries.length} gallery, ${plan.renames.length} rename(s)`)
    for (const [f, v] of Object.entries(count)) console.log(`  ${f.padEnd(11)} ${Object.entries(v).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
    for (const r of plan.renames) console.log(`  slug ${r.from} → ${r.to}`)
    console.log(`New in Sanity: ${created.length}`)
    for (const d of created) console.log(`  + ${sanitySlug(d)} — ${sanityValue(d, 'name')}`)
    console.log(`No Sanity document for ${deleted.length} node(s)${deleted.length ? `: ${deleted.slice(0, 5).map(g => g.slug).join(', ')}` : ''}`)
    console.log(`Left alone: ${plan.held.length} field(s)`)
    for (const h of plan.held.slice(0, 30)) console.log(`  ${h}`)
    if (plan.held.length > 30) console.log(`  … and ${plan.held.length - 30} more`)
    if (errors.length) console.log(`\nErrors (${errors.length}):\n  ${errors.join('\n  ')}`)

    mkdirSync(OUT, { recursive: true })
    writeFileSync(resolve(OUT, `${kind.key}-sync-plan.json`), JSON.stringify({
      generatedAt: new Date().toISOString(), counts: count, errors, held: plan.held,
      rows: plan.rows.filter(r => Object.keys(r.props).length).map(r => ({ slug: r.slug, props: r.props })),
      galleries: plan.galleries.map(g => ({ id: g.id, images: g.images.map(i => i.assetRef) })),
      renames: plan.renames,
      created: created.map(d => ({ slug: sanitySlug(d), name: sanityValue(d, 'name') })),
      noSanityDocument: deleted.map(g => g.slug),
    }, null, 2) + '\n')

    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }
    if (errors.length) { console.error('\nRefusing to write: there are errors.'); process.exitCode = 1; return }
    if (!plan.rows.length && !created.length) { console.log('\nNothing to write.'); return }

    // ── Backup ──
    const ids = [...new Set([...plan.rows.map(r => r.id), ...plan.galleries.map(g => g.id), ...plan.renames.map(r => r.id)])]
    const snap = (await read.run(backupQuery(kind), { ids })).records.map(r => r.toObject())
    const file = resolve(OUT, `${kind.key}-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify({ created: created.map(d => d._id), renames: plan.renames, nodes: snap }) + '\n')
    console.log(`\nBackup of ${snap.length} nodes: ${file}`)

    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    try {
      const run = async (query: string, params: Record<string, unknown>, expected: number, what: string) => {
        const n = asInt((await ws.executeWrite(tx => tx.run(query, params))).records[0].get('n'))
        if (n !== expected) throw new Error(`${what}: ${n} of ${expected} nodes matched — stopping`)
      }
      for (let i = 0; i < plan.rows.length; i += BATCH) {
        const batch = plan.rows.slice(i, i + BATCH)
        await run(applyQuery(kind), { rows: batch.map(r => ({ id: r.id, props: r.props, stamps: r.stamps, at: r.at })) }, batch.length, `apply batch at ${i}`)
      }
      const news = created.map(d => ({ props: newPlaceProps(kind, d) }))
      for (let i = 0; i < news.length; i += BATCH) await run(createQuery(kind), { rows: news.slice(i, i + BATCH) }, Math.min(BATCH, news.length - i), `create batch at ${i}`)
      const galleries = [...plan.galleries, ...created.map(d => ({ id: d._id, images: sanityImages(d) })).filter(g => g.images.length)]
      for (let i = 0; i < galleries.length; i += BATCH) {
        const batch = galleries.slice(i, i + BATCH)
        await run(galleryQuery(kind), { rows: batch }, batch.length, `gallery batch at ${i}`)
      }
      if (plan.renames.length) {
        await run(renamePhaseQuery(kind), { renames: plan.renames.map(r => ({ id: r.id, to: `__renaming__${r.id}` })) }, plan.renames.length, 'rename (placeholder)')
        await run(renamePhaseQuery(kind), { renames: plan.renames.map(r => ({ id: r.id, to: r.to })) }, plan.renames.length, 'rename')
        await ws.executeWrite(tx => tx.run(renameAliases(kind.label, kind.route), { renames: plan.renames.map(r => ({ id: r.id, from: r.from })), at: new Date().toISOString() }))
        await ws.executeWrite(tx => tx.run(dropShadowedAliases(kind.label, kind.route)))
      }
      const newest = docs.map(d => d._updatedAt).reduce((a, b) => (b > a ? b : a), '')
      await ws.run(`MERGE (s:SyncState {source: 'sanity', type: $type}) SET s.importedUpTo = $newest, s.at = datetime()`, { type: kind.key, newest })
      console.log(`Applied: ${plan.rows.length} node(s), ${created.length} created, ${galleries.length} galleries, ${plan.renames.length} renamed. SyncState ${kind.key}.importedUpTo = ${newest}`)
    } finally { await ws.close() }
  } finally {
    await read.close()
    await driver.close()
  }
}
