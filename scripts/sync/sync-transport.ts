/**
 * Apply the Sanity → graph sync of a transport's own fields — name, type, unit, regser (#112).
 * The rules, and the hash check that decides what is written, are in
 * scripts/lib/transport-sync.ts and docs/SANITY-SYNC.md.
 *
 * Per field, against its `<field>_sha` stamp:
 *   clean       → Sanity's value is applied (tidied); the stamp moves
 *   already     → the stamp moves; the value is rewritten only to tidy its whitespace
 *   kept        → the graph edit stays; the stamp moves
 *   conflict    → left alone, listed (Sanity changed and the graph value was edited)
 *   review      → left alone, listed (no stamp, Sanity changed since the import);
 *                 `--accept-review=<slug>,…` applies Sanity's value for the named transports
 * Graph edits are never overwritten. New transports (a Sanity document with no node) are
 * created with the import's rule, tidied, and stamped. Nodes with no Sanity document are
 * listed, not touched.
 *
 * Before writing, the nodes it will change are saved to data/sanity-delta/transport-before-<time>.json.
 *
 * Usage: npx tsx scripts/sync/sync-transport.ts [--write] [--accept-review=<slug>,…]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import { neo4jDriver, type Doc } from '../lib/person-sync.ts'
import {
  APPLY_QUERY, CREATE_QUERY, GRAPH_QUERY, classifyTransport, fetchSanityTransports, needsTidy, newTransportProps,
  propsFor, sanityField, stampsFor, type FieldVerdict, type GraphTransport, type TransportFieldName,
  type TransportVerdict,
} from '../lib/transport-sync.ts'
loadEnv()

const write = process.argv.includes('--write')
const acceptReview = new Set(
  (process.argv.find(a => a.startsWith('--accept-review='))?.slice('--accept-review='.length) ?? '')
    .split(',').map(x => x.trim()).filter(Boolean))
const BATCH = 100
const OUT = resolve(process.cwd(), 'data', 'sanity-delta')

const slugOf = (d: Doc) => (d.slug as { current?: string } | undefined)?.current ?? ''
const asInt = (v: unknown): number => (neo4j.isInt(v) ? v.toNumber() : (v as number))

interface Row {
  id: string
  slug: string
  props: Record<string, string | null>
  stamps: Record<string, string>
  dropUnit: boolean
  /** null while a field is held for review: sanityUpdatedAt must not move past it. */
  at: string | null
}

function planTransport(g: GraphTransport, s: Doc, verdicts: FieldVerdict[], held: string[]): Row | null {
  const props: Record<string, string | null> = {}
  const taken: TransportFieldName[] = []
  let dropUnit = false, reviewHeld = false
  for (const { field, verdict } of verdicts) {
    const accepted = verdict === 'review' && acceptReview.has(g.slug)
    if (verdict === 'conflict') { held.push(`${g.slug}: ${field} (conflict)`); continue }
    if (verdict === 'review' && !accepted) { held.push(`${g.slug}: ${field} (review)`); reviewHeld = true; continue }
    // An empty name would blank the node's title: never taken from Sanity.
    if (field === 'name' && !sanityField(s, 'name')) { held.push(`${g.slug}: name (empty in Sanity)`); reviewHeld = true; continue }
    taken.push(field)
    if (verdict === 'kept') continue
    if (verdict === 'already' && !needsTidy(g, field)) continue
    Object.assign(props, propsFor(s, field))
    if (field === 'unit') dropUnit = true
  }
  if (!taken.length) return null
  return { id: g.sanityId, slug: g.slug, props, stamps: stampsFor(s, taken), dropUnit, at: reviewHeld ? null : s._updatedAt }
}

async function main() {
  const driver = neo4jDriver()
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  const errors: string[] = []
  try {
    const [docs, graphRows] = await Promise.all([fetchSanityTransports(), read.run(GRAPH_QUERY)])
    const graph = new Map<string, GraphTransport>(graphRows.records.map(r => {
      const o = r.toObject()
      const stamps = Object.fromEntries(Object.entries(o.stamps as Record<string, string | null>).filter(([, v]) => v))
      return [o.sanityId as string, { ...o, stamps } as GraphTransport]
    }))
    const sanity = new Map(docs.map(d => [d._id, d]))

    // Changed in Sanity (or not stamped yet).
    const count: Record<string, Record<TransportVerdict, number>> = {}
    const held: string[] = []
    const rows: Row[] = []
    for (const g of graph.values()) {
      const s = sanity.get(g.sanityId)
      if (!s) continue
      const verdicts = classifyTransport(g, s)
      for (const v of verdicts) (count[v.field] ??= { clean: 0, already: 0, conflict: 0, kept: 0, review: 0 })[v.verdict]++
      const row = planTransport(g, s, verdicts, held)
      if (row) rows.push(row)
    }
    for (const slug of acceptReview) {
      const g = [...graph.values()].find(x => x.slug === slug)
      if (!g || !classifyTransport(g, sanity.get(g.sanityId)!).some(v => v.verdict === 'review')) errors.push(`--accept-review: ${slug} has no review fields`)
    }

    // New in Sanity.
    const created = docs.filter(d => !graph.has(d._id))
    const taken = new Set((await read.run(`MATCH (n:Transport) RETURN n.slug AS slug`)).records.map(r => r.get('slug') as string))
    for (const d of created) {
      if (!slugOf(d)) errors.push(`no slug: ${d._id}`)
      else if (taken.has(slugOf(d))) errors.push(`slug taken: ${slugOf(d)}`)
      if (!sanityField(d, 'name')) errors.push(`no name: ${d._id}`)
    }
    const deleted = [...graph.values()].filter(g => !sanity.has(g.sanityId))

    // ── Report ──
    const stampOnly = rows.filter(r => !Object.keys(r.props).length).length
    console.log(`Transport: ${docs.length} in Sanity, ${graph.size} in the graph`)
    console.log(`To write: ${rows.length - stampOnly} node(s) with values, ${stampOnly} stamp only`)
    for (const [f, v] of Object.entries(count)) console.log(`  ${f.padEnd(7)} ${Object.entries(v).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
    console.log(`New in Sanity: ${created.length}`)
    for (const d of created) console.log(`  + ${slugOf(d)} — ${sanityField(d, 'name')}`)
    console.log(`No Sanity document for ${deleted.length} node(s)${deleted.length ? `: ${deleted.slice(0, 5).map(g => g.slug).join(', ')}` : ''}`)
    console.log(`Left alone: ${held.length} field(s)`)
    for (const h of held.slice(0, 30)) console.log(`  ${h}`)
    if (held.length > 30) console.log(`  … and ${held.length - 30} more`)
    if (errors.length) console.log(`\nErrors (${errors.length}):\n  ${errors.join('\n  ')}`)

    mkdirSync(OUT, { recursive: true })
    writeFileSync(resolve(OUT, 'transport-sync-plan.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), counts: count, errors, held,
      rows: rows.filter(r => Object.keys(r.props).length).map(r => ({ slug: r.slug, props: r.props })),
      created: created.map(d => ({ slug: slugOf(d), name: sanityField(d, 'name') })),
      noSanityDocument: deleted.map(g => g.slug),
    }, null, 2) + '\n')

    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }
    if (errors.length) { console.error('\nRefusing to write: there are errors.'); process.exitCode = 1; return }
    if (!rows.length && !created.length) { console.log('\nNothing to write.'); return }

    // ── Backup ──
    const snap = (await read.run(`
      UNWIND $ids AS id MATCH (n:Transport {sanityId: id})
      RETURN n.sanityId AS sanityId, n.slug AS slug, n.sanityUpdatedAt AS sanityUpdatedAt,
             properties(n) AS props`, { ids: rows.map(r => r.id) })).records.map(r => r.toObject())
    const file = resolve(OUT, `transport-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify({ created: created.map(d => d._id), nodes: snap }) + '\n')
    console.log(`\nBackup of ${snap.length} nodes: ${file}`)

    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    try {
      const run = async (query: string, batch: Record<string, unknown>[], what: string, i: number) => {
        const n = asInt((await ws.executeWrite(tx => tx.run(query, { rows: batch }))).records[0].get('n'))
        if (n !== batch.length) throw new Error(`${what} batch at ${i}: ${n} of ${batch.length} nodes matched — stopping`)
      }
      for (let i = 0; i < rows.length; i += BATCH) {
        await run(APPLY_QUERY, rows.slice(i, i + BATCH).map(r => ({ id: r.id, props: r.props, stamps: r.stamps, dropUnit: r.dropUnit, at: r.at })), 'apply', i)
      }
      const news = created.map(d => ({ props: newTransportProps(d) }))
      for (let i = 0; i < news.length; i += BATCH) await run(CREATE_QUERY, news.slice(i, i + BATCH), 'create', i)
      const newest = docs.map(d => d._updatedAt).reduce((a, b) => (b > a ? b : a), '')
      await ws.run(`MERGE (s:SyncState {source: 'sanity', type: 'transport'}) SET s.importedUpTo = $newest, s.at = datetime()`, { newest })
      console.log(`Applied: ${rows.length} node(s), ${created.length} created. SyncState transport.importedUpTo = ${newest}`)
    } finally { await ws.close() }
  } finally {
    await read.close()
    await driver.close()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
