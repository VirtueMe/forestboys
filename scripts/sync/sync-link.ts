/**
 * Apply the Sanity → graph sync of `links` for transports, locations, stations and outlines (#118, #301). The rules, and the hash check
 * that decides what is written, are in scripts/lib/link-sync.ts and docs/SANITY-SYNC.md («Links»).
 *
 * Per node, against its `links_sha` stamp:
 *   clean      → Sanity's links are the node's import links; a link Sanity dropped goes; the stamp moves
 *   gap        → Sanity's missing links are added, nothing is removed; the stamp moves
 *   already    → only the stamp moves
 *   conflict   → left alone, listed (Sanity changed and the graph's links were edited)
 *   review     → left alone, listed (no stamp, no baseline); `--accept-review=<slug>,…` applies Sanity's set
 *   unchanged  → nothing
 * An edge an editor made (`admin-edit`) is never removed. Nodes with no Sanity document, and Sanity documents with no
 * node, are left alone (a new node comes with its type's own sync).
 *
 * Before writing, the nodes it will change (stamp and links) are saved to data/sanity-delta/links-before-<type>-<time>.json.
 *
 * Usage: npx tsx scripts/sync/sync-link.ts --type=transport|location|station|outline|all [--production] [--write] [--accept-review=<slug>,…]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import { connectNeo4j, neo4jDriver } from '../lib/person-sync.ts'
import { loadBaselineFile } from '../lib/baseline.ts'
import {
  LINK_KINDS, applyQuery, backupQuery, classifyLinks, fetchSanityLinks, graphQuery, sanityLinkSources, stampsFor,
  type GraphLinks, type LinkKind, type LinkVerdict,
} from '../lib/link-sync.ts'
loadEnv()

const write = process.argv.includes('--write')
const typeArg = process.argv.find(a => a.startsWith('--type='))?.slice('--type='.length)
const acceptReview = new Set(
  (process.argv.find(a => a.startsWith('--accept-review='))?.slice('--accept-review='.length) ?? '')
    .split(',').map(x => x.trim()).filter(Boolean))
const BATCH = 100
const OUT = resolve(process.cwd(), 'data', 'sanity-delta')
/** The export the graph was imported from (local only; CI has none, and a node with no stamp goes to review). */
const baselinePath = (kind: LinkKind) => resolve(process.cwd(), 'data', 'sanity-baseline-2026-04', `sanity-${kind.key}.json`)

const kinds: LinkKind[] = typeArg === 'all' ? Object.values(LINK_KINDS) : typeArg && LINK_KINDS[typeArg] ? [LINK_KINDS[typeArg]] : []
if (!kinds.length) {
  console.error(`--type=<${[...Object.keys(LINK_KINDS), 'all'].join('|')}> is required.`)
  process.exit(2)
}

const asInt = (v: unknown): number => (neo4j.isInt(v) ? v.toNumber() : (v as number))

async function syncKind(kind: LinkKind, driver: ReturnType<typeof neo4jDriver>, errors: string[]): Promise<boolean> {
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  const [docs, graphRows] = await Promise.all([fetchSanityLinks(kind), read.run(graphQuery(kind))])
  await read.close()
  const graph = new Map<string, GraphLinks>(graphRows.records.map(r => [
    r.get('sanityId') as string,
    { sanityId: r.get('sanityId'), slug: r.get('slug'), links: r.get('links'), stamp: r.get('stamp') ?? undefined },
  ]))
  const baseline = loadBaselineFile(baselinePath(kind))

  const count: Record<LinkVerdict, number> = { unchanged: 0, clean: 0, already: 0, conflict: 0, gap: 0, review: 0 }
  const rows: { id: string; links: unknown[]; prune: boolean; stamps: Record<string, string> }[] = []
  const held: string[] = [], changes: string[] = []
  const withReview = new Set<string>()
  const skipped: string[] = []
  let noNode = 0
  for (const d of docs) {
    const g = graph.get(d._id)
    if (!g) { noNode++; continue }
    if (kind.skip?.has(d._id)) { skipped.push(`${g.slug} (${kind.skip.get(d._id)})`); continue }
    let v = classifyLinks(g, d, baseline.get(d._id))
    count[v]++
    if (v === 'review') withReview.add(g.slug)
    if (v === 'review' && acceptReview.has(g.slug)) v = 'clean'
    if (v === 'conflict' || v === 'review') { held.push(`${g.slug} (${v})`); continue }
    if (v === 'unchanged') continue
    const links = v === 'already' ? [] : sanityLinkSources(d)
    if (v === 'clean' || v === 'gap') {
      const have = new Set(g.links)
      const added = links.filter(l => !have.has(l.url)).length
      const dropped = v === 'clean' ? g.links.filter(u => !links.some(l => l.url === u)).length : 0
      changes.push(`${g.slug} (${v}): +${added} -${dropped}`)
    }
    rows.push({ id: d._id, links, prune: v === 'clean', stamps: stampsFor(d) })
  }
  for (const slug of acceptReview) if (!withReview.has(slug) && [...graph.values()].some(g => g.slug === slug)) errors.push(`--accept-review: ${slug} has no review links`)

  console.log(`\n${kind.label}: ${docs.length} in Sanity, ${graph.size} in the graph`)
  console.log(`  clean ${count.clean} · gap ${count.gap} · already ${count.already} · unchanged ${count.unchanged} · conflict ${count.conflict} · review ${count.review}`)
  console.log(`  no node for ${noNode} Sanity document(s)`)
  for (const k of skipped) console.log(`  skipped: ${k}`)
  console.log(`  To write: ${changes.length} node(s) with link changes, ${rows.length - changes.length} stamp only`)
  for (const c of changes.slice(0, 40)) console.log(`    ${c}`)
  if (changes.length > 40) console.log(`    … and ${changes.length - 40} more`)
  for (const h of held.slice(0, 20)) console.log(`  left alone: ${h}`)
  if (held.length > 20) console.log(`  … and ${held.length - 20} more`)

  mkdirSync(OUT, { recursive: true })
  writeFileSync(resolve(OUT, `links-sync-${kind.key}-plan.json`), JSON.stringify({
    generatedAt: new Date().toISOString(), counts: count, noNode, held, changes,
    rows: rows.map(r => ({ id: r.id, prune: r.prune, links: (r.links as { url: string }[]).map(l => l.url) })),
  }, null, 2) + '\n')

  if (!write) return true
  if (errors.length) return false
  if (!rows.length) { console.log('  nothing to write'); return true }

  const rs = driver.session({ defaultAccessMode: neo4j.session.READ })
  let snap: Record<string, unknown>[]
  try { snap = (await rs.run(backupQuery(kind), { ids: rows.map(r => r.id) })).records.map(r => r.toObject()) } finally { await rs.close() }
  const file = resolve(OUT, `links-before-${kind.key}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(snap) + '\n')
  console.log(`  Backup of ${snap.length} nodes: ${file}`)

  const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const n = asInt((await ws.executeWrite(tx => tx.run(applyQuery(kind), { rows: batch }))).records[0].get('n'))
      if (n !== batch.length) {
        console.error(`  Batch at ${i}: ${n} of ${batch.length} nodes matched — stopping.`)
        process.exitCode = 1
        return false
      }
    }
    const newest = docs.map(d => d._updatedAt).reduce((a, b) => (b > a ? b : a), '')
    await ws.run(`MERGE (s:SyncState {source: 'sanity', type: $type}) SET s.importedUpTo = $newest, s.at = datetime()`,
      { type: `${kind.key}-links`, newest })
    console.log(`  Applied: ${rows.length} node(s). SyncState ${kind.key}-links.importedUpTo = ${newest}`)
    return true
  } finally { await ws.close() }
}

async function main() {
  const driver = await connectNeo4j()
  try {
    const errors: string[] = []
    for (const kind of kinds) if (!(await syncKind(kind, driver, errors))) break
    if (errors.length) { console.error(`\nErrors (${errors.length}):\n  ${errors.join('\n  ')}`); process.exitCode = 1 }
    else if (!write) console.log('\n(dry run — pass --write to apply)')
  } finally { await driver.close() }
}
main().catch(e => { console.error(e); process.exit(1) })
