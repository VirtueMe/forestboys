/**
 * Sanity → Neo4j sync report: what changed in Sanity since the graph last
 * took it in. Read-only — writes nothing to Sanity or Neo4j.
 *
 * Marker: `(:SyncState {source: 'sanity', type, importedUpTo})` per Sanity
 * type, holding Sanity's own `_updatedAt` (not our clock) of the newest
 * change the graph has. The importer — not this script — advances it, in
 * the same transaction as the data, so a fetched-but-not-imported change
 * is fetched again next time. Until a marker exists it is derived from
 * the newest `sanityUpdatedAt` on the type's nodes.
 *
 * Per type:
 *   - changes: `_updatedAt >= marker` (>= so a document edited in the same
 *     second as the marker isn't missed; duplicates are harmless)
 *   - deletions: a date filter can't see them, so the full `_id` list is
 *     compared with the graph's `sanityId`s
 *
 * Reads from api.sanity.io, not the CDN — the CDN can lag.
 *
 * Output: data/sanity-delta/<type>.json (changed + new documents) and
 * data/sanity-delta/report.json. The full exports in data/sanity-*.json
 * are not touched.
 *
 * Usage: npx tsx scripts/sanity-sync.ts [--type person]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j, { type Session } from 'neo4j-driver'
import * as dotenv from 'dotenv'
dotenv.config()

const API     = 'https://7r6kqtqy.api.sanity.io/v2021-08-31/data/query/production'
const OUT_DIR = resolve(process.cwd(), 'data', 'sanity-delta')

/** Sanity type → the Neo4j labels its documents became. [] = not imported. */
const TYPES: Record<string, string[]> = {
  person:       ['Person'],
  location:     ['Location'],
  station:      ['Station'],
  district:     ['Unit'],
  organization: ['Organization'],
  transport:    ['Transport'],
  event:        ['Incident', 'Operation'],
  outline:      ['Outline'],
  airfield:     [],
  partner:      [],
}

interface SanityDoc { _id: string; _updatedAt: string; title?: string; name?: string; [k: string]: unknown }

async function groq<T>(query: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(API)
  url.searchParams.set('query', query)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`$${k}`, JSON.stringify(v))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sanity ${res.status}: ${await res.text()}`)
  return (await res.json() as { result: T }).result
}

/** Published documents of `type` updated at/after `since` (all when null), paged by _id. */
async function fetchChanged(type: string, since: string | null): Promise<SanityDoc[]> {
  const out: SanityDoc[] = []
  let lastId = ''
  for (;;) {
    const page = await groq<SanityDoc[]>(
      `*[_type == $type && !(_id in path("drafts.**")) && _id > $lastId
         && ($since == null || _updatedAt >= $since)] | order(_id asc) [0...500]`,
      { type, lastId, since },
    )
    out.push(...page)
    if (page.length < 500) return out
    lastId = page[page.length - 1]._id
  }
}

async function fetchIds(type: string): Promise<string[]> {
  return groq<string[]>(`*[_type == $type && !(_id in path("drafts.**"))]._id`, { type })
}

interface GraphNode { id: string; updatedAt: string | null }

async function graphNodes(session: Session, labels: string[]): Promise<Map<string, GraphNode>> {
  const nodes = new Map<string, GraphNode>()
  for (const label of labels) {
    const r = await session.run(
      `MATCH (n:${label}) WHERE n.sanityId IS NOT NULL
       RETURN n.sanityId AS id, n.sanityUpdatedAt AS updatedAt`)
    for (const rec of r.records) nodes.set(rec.get('id'), { id: rec.get('id'), updatedAt: rec.get('updatedAt') })
  }
  return nodes
}

async function marker(session: Session, type: string, nodes: Map<string, GraphNode>):
    Promise<{ since: string | null; from: 'SyncState' | 'derived' | 'none' }> {
  const r = await session.run(
    `MATCH (s:SyncState {source: 'sanity', type: $type}) RETURN s.importedUpTo AS t`, { type })
  const stored = r.records[0]?.get('t') as string | undefined
  if (stored) return { since: stored, from: 'SyncState' }
  const times = [...nodes.values()].map(n => n.updatedAt).filter((t): t is string => !!t)
  if (times.length) return { since: times.reduce((a, b) => (a > b ? a : b)), from: 'derived' }
  return { since: null, from: 'none' }
}

const label = (d: SanityDoc) => String(d.title ?? d.name ?? '')

async function main() {
  const only = process.argv.includes('--type') ? process.argv[process.argv.indexOf('--type') + 1] : null
  const types = Object.keys(TYPES).filter(t => !only || t === only)
  if (!types.length) throw new Error(`Unknown type: ${only}`)

  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
  )
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })
  mkdirSync(OUT_DIR, { recursive: true })
  const report: Record<string, unknown> = { fetchedAt: new Date().toISOString(), types: {} }

  try {
    // "New" means nowhere in the graph — a document can land under another
    // label than its type suggests (the Linge organization is a Unit).
    const all = await session.run(`MATCH (n) WHERE n.sanityId IS NOT NULL RETURN collect(DISTINCT n.sanityId) AS ids`)
    const inGraph = new Set(all.records[0].get('ids') as string[])

    console.log('type          marker                     sanity  graph   new  changed  unknown  deleted  other-type')
    for (const type of types) {
      const labels = TYPES[type]
      const nodes  = await graphNodes(session, labels)
      const { since, from } = await marker(session, type, nodes)
      const [changedDocs, ids] = await Promise.all([fetchChanged(type, since), fetchIds(type)])

      const idSet   = new Set(ids)
      const newIds  = ids.filter(id => !inGraph.has(id))
      const newSet  = new Set(newIds)
      // Changed: in the graph, and Sanity's copy is newer than what the graph took in.
      // Unknown: in the graph without a sanityUpdatedAt to compare against.
      const changed = changedDocs.filter(d => {
        const n = nodes.get(d._id)
        return n?.updatedAt && d._updatedAt > n.updatedAt
      })
      const unknown = changedDocs.filter(d => nodes.has(d._id) && !nodes.get(d._id)!.updatedAt)
      // Not in Sanity as this type: either deleted, or the node's sanityId
      // is some other type's document (e.g. a Unit made from an outline).
      const absent  = [...nodes.keys()].filter(id => !idSet.has(id))
      const elsewhere = absent.length
        ? await groq<{ _id: string; _type: string }[]>(`*[_id in $ids]{_id, _type}`, { ids: absent })
        : []
      const otherType = new Map(elsewhere.map(d => [d._id, d._type]))
      const deleted = absent.filter(id => !otherType.has(id))

      // New documents may predate the marker (created before, never imported) — fetch those too.
      const missing = newIds.filter(id => !changedDocs.some(d => d._id === id))
      const newDocs = [
        ...changedDocs.filter(d => newSet.has(d._id)),
        ...(missing.length ? await groq<SanityDoc[]>(`*[_id in $ids]`, { ids: missing }) : []),
      ]

      writeFileSync(resolve(OUT_DIR, `${type}.json`),
        JSON.stringify({ since, sinceFrom: from, new: newDocs, changed, unknown }, null, 2) + '\n')

      const maxSeen = changedDocs.map(d => d._updatedAt).reduce<string | null>((a, b) => (!a || b > a ? b : a), null)
      ;(report.types as Record<string, unknown>)[type] = {
        labels, since, sinceFrom: from, maxUpdatedAtSeen: maxSeen,
        sanityCount: ids.length, graphCount: nodes.size,
        new:     newDocs.map(d => ({ id: d._id, title: label(d), updatedAt: d._updatedAt })),
        changed: changed.map(d => ({ id: d._id, title: label(d), updatedAt: d._updatedAt })),
        unknown: unknown.length,
        deleted,
        otherType: Object.fromEntries(otherType),
      }

      const m = since ? `${since} ${from === 'derived' ? '*' : ' '}` : '(none)'.padEnd(22)
      console.log(
        `${type.padEnd(13)} ${m.padEnd(26)} ${String(ids.length).padStart(6)} ${String(nodes.size).padStart(6)}` +
        ` ${String(newDocs.length).padStart(5)} ${String(changed.length).padStart(8)}` +
        ` ${String(unknown.length).padStart(8)} ${String(deleted.length).padStart(8)} ${String(otherType.size).padStart(11)}` +
        (labels.length ? '' : '   (not imported)'))
    }
  } finally {
    await session.close()
    await driver.close()
  }

  writeFileSync(resolve(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`\n* derived from the newest sanityUpdatedAt in the graph (no SyncState yet)`)
  console.log(`Details: data/sanity-delta/report.json · documents: data/sanity-delta/<type>.json`)
}
void main().catch(e => { console.error(e); process.exit(1) })
