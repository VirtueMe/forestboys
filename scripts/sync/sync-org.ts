/**
 * Apply the Sanity → graph sync of organizations and districts (#300, part of #156). The rules, and the hash check that
 * decides what is written, are in scripts/lib/org-sync.ts and docs/SANITY-SYNC.md («Organizations and districts»).
 *
 * Per field, against its `<field>_sha` stamp:
 *   clean       → Sanity's value is applied; the stamp moves
 *   already     → only the stamp moves
 *   kept        → the graph edit stays; the stamp moves
 *   conflict    → left alone, listed (Sanity changed and the graph value was edited)
 *   review      → left alone, listed (no stamp, Sanity changed since the import);
 *                 `--accept-review=<slug>,…` applies Sanity's value for the named nodes
 * Graph edits are never overwritten. A document new in Sanity gets a node by the import's rule (an organization with
 * the `NN-` sort prefix split off, a district as a Unit of type district). The slug is not changed by a rename. Nodes with
 * no Sanity document are listed, not touched; Sanity documents in LEFT_TO_JAN are listed, not brought in.
 *
 * Before writing, the nodes it will change are saved to data/sanity-delta/<type>-before-<time>.json.
 *
 * Usage: npx tsx scripts/sync/sync-org.ts --type=organization|district|all [--production] [--write] [--accept-review=<slug>,…]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import { connectNeo4j, neo4jDriver, type Doc } from '../lib/person-sync.ts'
import { loadBaselineFile } from '../lib/baseline.ts'
import {
  DISTRICT, LEFT_TO_JAN, ORGANIZATION, applyQuery, backupQuery, classifyOrg, createQuery, fetchSanityOrgs, graphQuery, newOrgProps,
  newSlug, planOrg, sanityValue, slugsQuery, type FieldVerdict, type GraphOrg, type OrgFieldName, type OrgKind, type OrgRow, type OrgVerdict,
} from '../lib/org-sync.ts'
loadEnv()

const write = process.argv.includes('--write')
const typeArg = process.argv.find(a => a.startsWith('--type='))?.slice('--type='.length)
const acceptReview = new Set(
  (process.argv.find(a => a.startsWith('--accept-review='))?.slice('--accept-review='.length) ?? '')
    .split(',').map(x => x.trim()).filter(Boolean))
const BATCH = 100
const OUT = resolve(process.cwd(), 'data', 'sanity-delta')
const SLUG_RE = /^[a-z0-9-]+$/
/** The export the graph was imported from (local only; CI goes by the stamps). */
const baselinePath = (kind: OrgKind) => resolve(process.cwd(), 'data', 'sanity-baseline-2026-04', `sanity-${kind.key}.json`)

const KINDS: Record<string, OrgKind> = { organization: ORGANIZATION, district: DISTRICT }
const kinds: OrgKind[] = typeArg === 'all' ? Object.values(KINDS) : typeArg && KINDS[typeArg] ? [KINDS[typeArg]] : []
if (!kinds.length) {
  console.error(`--type=<${[...Object.keys(KINDS), 'all'].join('|')}> is required.`)
  process.exit(2)
}

const asInt = (v: unknown): number => (neo4j.isInt(v) ? v.toNumber() : (v as number))
const name = (d: Doc) => (typeof d.name === 'string' ? d.name : '')

async function syncKind(kind: OrgKind, driver: ReturnType<typeof neo4jDriver>, errors: string[]): Promise<boolean> {
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  const baseline = loadBaselineFile(baselinePath(kind))
  let docs, graph: Map<string, GraphOrg>, taken: Set<string>
  try {
    docs = await fetchSanityOrgs(kind)
    graph = new Map((await read.run(graphQuery(kind))).records.map(r => {
      const o = r.toObject()
      const stamps = Object.fromEntries(Object.entries(o.stamps as Record<string, string | null>).filter(([, v]) => v))
      return [o.sanityId as string, { ...o, stamps } as GraphOrg]
    }))
    taken = new Set((await read.run(slugsQuery(kind))).records.map(r => r.get('slug') as string))
  } finally { await read.close() }
  const sanity = new Map(docs.map(d => [d._id, d]))

  // Changed in Sanity (or not stamped yet).
  const count: Partial<Record<OrgFieldName, Record<OrgVerdict, number>>> = {}
  const held: string[] = []
  const rows: OrgRow[] = []
  const withReview = new Set<string>()
  for (const g of graph.values()) {
    const s = sanity.get(g.sanityId)
    if (!s) continue
    let verdicts: FieldVerdict[] = classifyOrg(kind, g, s, baseline.get(g.sanityId))
    for (const v of verdicts) (count[v.field] ??= { clean: 0, already: 0, conflict: 0, kept: 0, review: 0 })[v.verdict]++
    if (verdicts.some(v => v.verdict === 'review')) withReview.add(g.slug)
    verdicts = verdicts.map(v => v.verdict === 'review' && acceptReview.has(g.slug) ? { ...v, verdict: 'clean' as const } : v)
    const row = planOrg(kind, g, s, verdicts, held)
    if (row) rows.push(row)
  }
  for (const slug of acceptReview) if (!withReview.has(slug) && [...graph.values()].some(g => g.slug === slug)) errors.push(`--accept-review: ${slug} has no review fields`)

  // New in Sanity, and the slugs as they will be.
  const left = docs.filter(d => !graph.has(d._id) && LEFT_TO_JAN.has(d._id))
  const created = docs.filter(d => !graph.has(d._id) && !LEFT_TO_JAN.has(d._id))
  const used = new Set(taken)
  for (const d of created) {
    const slug = newSlug(kind, d)
    if (!slug) errors.push(`${kind.key}: no slug: ${d._id} («${name(d)}»)`)
    else if (!SLUG_RE.test(slug)) errors.push(`${kind.key}: odd slug: ${slug}`)
    else if (used.has(slug)) errors.push(`${kind.key}: slug taken: ${slug} (new ${d._id})`)
    used.add(slug)
    if (!sanityValue(kind, d, 'name').replace('|', '')) errors.push(`${kind.key}: no name: ${d._id}`)
  }
  const deleted = [...graph.values()].filter(g => !sanity.has(g.sanityId))

  // ── Report ──
  const stampOnly = rows.filter(r => !Object.keys(r.props).length).length
  console.log(`\n${kind.key}: ${docs.length} in Sanity, ${graph.size} in the graph`)
  console.log(`  To write: ${rows.length - stampOnly} node(s) with values, ${stampOnly} stamp only`)
  for (const [f, v] of Object.entries(count)) console.log(`    ${f.padEnd(6)} ${Object.entries(v).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
  console.log(`  New in Sanity: ${created.length}`)
  for (const d of created) console.log(`    + ${newSlug(kind, d)} — «${name(d)}»`)
  for (const d of left) console.log(`  Left to Jan: «${name(d)}» (${LEFT_TO_JAN.get(d._id)})`)
  console.log(`  No Sanity document for ${deleted.length} node(s)${deleted.length ? `: ${deleted.map(g => g.slug).join(', ')}` : ''}`)
  console.log(`  Left alone: ${held.length} field(s)`)
  for (const h of held.slice(0, 30)) console.log(`    ${h}`)
  if (held.length > 30) console.log(`    … and ${held.length - 30} more`)

  mkdirSync(OUT, { recursive: true })
  writeFileSync(resolve(OUT, `${kind.key}-sync-plan.json`), JSON.stringify({
    generatedAt: new Date().toISOString(), counts: count, held,
    rows: rows.filter(r => Object.keys(r.props).length).map(r => ({ slug: r.slug, props: r.props })),
    created: created.map(d => ({ slug: newSlug(kind, d), name: name(d) })),
    leftToJan: left.map(d => d._id), noSanityDocument: deleted.map(g => g.slug),
  }, null, 2) + '\n')

  if (!write) return true
  if (errors.length) return false
  if (!rows.length && !created.length) { console.log('  Nothing to write.'); return true }

  // ── Backup ──
  const rs = driver.session({ defaultAccessMode: neo4j.session.READ })
  let snap: Record<string, unknown>[]
  try { snap = (await rs.run(backupQuery(kind), { ids: rows.map(r => r.id) })).records.map(r => r.toObject()) } finally { await rs.close() }
  const file = resolve(OUT, `${kind.key}-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ created: created.map(d => d._id), nodes: snap }) + '\n')
  console.log(`  Backup of ${snap.length} nodes: ${file}`)

  const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try {
    const run = async (query: string, batch: Record<string, unknown>[], what: string, i: number) => {
      const n = asInt((await ws.executeWrite(tx => tx.run(query, { rows: batch }))).records[0].get('n'))
      if (n !== batch.length) throw new Error(`${what} batch at ${i}: ${n} of ${batch.length} nodes matched — stopping`)
    }
    for (let i = 0; i < rows.length; i += BATCH) {
      await run(applyQuery(kind), rows.slice(i, i + BATCH).map(r => ({ id: r.id, props: r.props, stamps: r.stamps, at: r.at })), 'apply', i)
    }
    const news = created.map(d => ({ props: newOrgProps(kind, d) }))
    for (let i = 0; i < news.length; i += BATCH) await run(createQuery(kind), news.slice(i, i + BATCH), 'create', i)
    const newest = docs.map(d => d._updatedAt).reduce((a, b) => (b > a ? b : a), '')
    await ws.run(`MERGE (s:SyncState {source: 'sanity', type: $type}) SET s.importedUpTo = $newest, s.at = datetime()`, { type: kind.key, newest })
    console.log(`  Applied: ${rows.length} node(s), ${created.length} created. SyncState ${kind.key}.importedUpTo = ${newest}`)
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
