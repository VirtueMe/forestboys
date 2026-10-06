/**
 * Apply the Sanity → graph sync of descriptions for transports (and, as they are added to KINDS,
 * stations and locations) — #99. The rules, and the hash check that decides what is written,
 * are in scripts/lib/description-sync.ts and docs/SANITY-SYNC.md.
 *
 * Per node, against its `description_sha` stamp:
 *   new, clean  → Sanity's text goes in the order-1 Description (an existing one keeps its node
 *                 and edges, so an editor's citations stay); the stamp moves
 *   already     → only the stamp moves
 *   conflict    → left alone, listed (Sanity changed and the graph text was edited)
 *   review      → left alone, listed (no stamp, and the graph has text of its own)
 *   unchanged   → nothing
 * Graph text is never overwritten. Nodes with no Sanity document, and Sanity documents with
 * no node, are left alone (they come with their type's own import).
 *
 * Before writing, the nodes it will change (stamp and order-1 Description) are saved to
 * data/sanity-delta/description-before-<type>-<time>.json.
 *
 * Usage: npx tsx scripts/sync/sync-description.ts --type=transport|all [--write]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import { neo4jDriver, sha } from '../lib/person-sync.ts'
import {
  GRAPH_QUERY, KINDS, REMOVE_QUERY, STAMP_QUERY, UPSERT_QUERY, classifyDescription, descriptionId, fetchSanityDescriptions, graphValue,
  importedBlocks, stampsFor, type DescriptionKind, type DescriptionVerdict, type GraphDescription,
} from '../lib/description-sync.ts'
loadEnv()

const write = process.argv.includes('--write')
const typeArg = process.argv.find(a => a.startsWith('--type='))?.slice('--type='.length)
const BATCH = 100
const OUT = resolve(process.cwd(), 'data', 'sanity-delta')

const kinds: DescriptionKind[] = typeArg === 'all' ? Object.values(KINDS) : typeArg && KINDS[typeArg] ? [KINDS[typeArg]] : []
if (!kinds.length) {
  console.error(`--type=<${[...Object.keys(KINDS), 'all'].join('|')}> is required.`)
  process.exit(2)
}

async function syncKind(kind: DescriptionKind, driver: ReturnType<typeof neo4jDriver>): Promise<boolean> {
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  const docs = await fetchSanityDescriptions(kind)
  const graph = new Map<string, GraphDescription>((await read.run(GRAPH_QUERY(kind))).records.map(r => [
    r.get('sanityId') as string,
    { sanityId: r.get('sanityId'), slug: r.get('slug'), stamp: r.get('stamp') ?? undefined, content: r.get('content') ?? null },
  ]))
  await read.close()

  const count: Record<DescriptionVerdict, number> = { unchanged: 0, new: 0, clean: 0, already: 0, conflict: 0, review: 0 }
  const upsert: Record<string, unknown>[] = [], remove: Record<string, unknown>[] = [], stampOnly: Record<string, unknown>[] = []
  const held: string[] = []
  let noNode = 0, editedSinceImport = 0
  for (const d of docs) {
    const g = graph.get(d._id)
    if (!g) { noNode++; continue }
    const v = classifyDescription(g, d)
    count[v]++
    if (v === 'unchanged' && g.stamp !== undefined && sha(graphValue(g.content)) !== g.stamp) editedSinceImport++
    if (v === 'conflict' || v === 'review') { held.push(`${g.slug} (${v})`); continue }
    if (v === 'new' || v === 'clean') {
      const blocks = importedBlocks(d)
      const row = { id: d._id, descId: descriptionId(kind, g.slug), content: blocks ? JSON.stringify(blocks) : null, stamps: stampsFor(kind, d) }
      ;(blocks ? upsert : remove).push(row)
    }
    if (v === 'already') stampOnly.push({ id: d._id, stamps: stampsFor(kind, d) })
  }

  console.log(`\n${kind.label}: ${docs.length} in Sanity, ${graph.size} in the graph`)
  console.log(`  new ${count.new} · clean ${count.clean} · already ${count.already} · unchanged ${count.unchanged} · conflict ${count.conflict} · review ${count.review}`)
  console.log(`  no node for ${noNode} Sanity document(s) · graph text edited since the import (not a conflict until Sanity changes): ${editedSinceImport}`)
  for (const h of held.slice(0, 20)) console.log(`  left alone: ${h}`)
  if (held.length > 20) console.log(`  … and ${held.length - 20} more`)

  mkdirSync(OUT, { recursive: true })
  writeFileSync(resolve(OUT, `description-sync-${kind.key}-plan.json`), JSON.stringify({
    generatedAt: new Date().toISOString(), counts: count, noNode, editedSinceImport, held,
    upsert: upsert.map(a => a.id), remove: remove.map(a => a.id), stampOnly: stampOnly.map(s => s.id),
  }, null, 2) + '\n')

  if (!write) return true
  if (!upsert.length && !remove.length && !stampOnly.length) { console.log('  nothing to write'); return true }

  const ids = [...upsert, ...remove, ...stampOnly].map(x => x.id)
  const snap = await (async () => {
    const s = driver.session({ defaultAccessMode: neo4j.session.READ })
    try {
      return (await s.run(`
        UNWIND $ids AS id MATCH (n:\`${kind.label}\` {sanityId: id})
        RETURN n.sanityId AS sanityId, n.slug AS slug,
               {sha: n.description_sha, sourceRef: n.description_sourceRef, state: n.description_state, sanityUpdatedAt: n.description_sanityUpdatedAt} AS stamps,
               [(n)-[:HAS_CONTENT]->(d:Description) WHERE d.order = 1 |
                 {props: properties(d), edges: [(d)-[r]-(o) | {type: type(r), out: startNode(r) = d, other: coalesce(o.id, o.slug), props: properties(r)}]}] AS descriptions`, { ids })).records.map(r => r.toObject())
    } finally { await s.close() }
  })()
  const file = resolve(OUT, `description-before-${kind.key}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(snap) + '\n')
  console.log(`  Backup of ${snap.length} nodes: ${file}`)

  const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try {
    for (const [rows, query] of [[upsert, UPSERT_QUERY(kind)], [remove, REMOVE_QUERY(kind)], [stampOnly, STAMP_QUERY(kind)]] as const) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        const res = await ws.executeWrite(tx => tx.run(query, { rows: batch }))
        const raw = res.records[0].get('n')
        const n = neo4j.isInt(raw) ? raw.toNumber() : (raw as number)
        if (n !== batch.length) {
          console.error(`  Batch at ${i}: ${n} of ${batch.length} nodes matched — stopping.`)
          process.exitCode = 1
          return false
        }
      }
    }
    const newest = docs.map(d => d._updatedAt).reduce((a, b) => (b > a ? b : a), '')
    await ws.run(`MERGE (s:SyncState {source: 'sanity', type: $type}) SET s.importedUpTo = $newest, s.at = datetime()`,
      { type: `${kind.key}-description`, newest })
    console.log(`  Applied: ${upsert.length} written, ${remove.length} removed, ${stampOnly.length} stamped. SyncState ${kind.key}-description.importedUpTo = ${newest}`)
    return true
  } finally { await ws.close() }
}

async function main() {
  const driver = neo4jDriver()
  try {
    for (const kind of kinds) if (!(await syncKind(kind, driver))) return
    if (!write) console.log('\n(dry run — pass --write to apply)')
  } finally { await driver.close() }
}
main().catch(e => { console.error(e); process.exit(1) })
