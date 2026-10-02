/**
 * People deleted in Sanity (docs/SANITY-SYNC.md, "Sync" step 4).
 *
 * A Person whose sanityId is gone from Sanity is listed with what deleting
 * it would do. Most deletions are Jan merging a duplicate into another
 * person ("O Aksdal" → "Otto Ferdinand Aksdal"), which shows in the events:
 * where the deleted person was, the Sanity event now names the survivor.
 *
 * - Edges the import made — known rank, links, Sanity gallery images, the
 *   imported description, event edges (INVOLVED_IN / PARTICIPATED_IN) with a
 *   `sanity…` sourceRef — go with the person.
 * - An event edge moves to the survivor when the Sanity event now names
 *   exactly one person the graph doesn't have on it yet. Otherwise it is
 *   dropped, as Sanity no longer has it.
 * - Anything entered in the graph blocks the deletion: rank history,
 *   stays, notes, editor-marked links or images, mentions in other
 *   descriptions, any edge without a Sanity sourceRef.
 *
 * Applied only for people named in `--accept-delete` (scripts/sync-person.ts).
 */

import { type Driver } from 'neo4j-driver'
import { API, type Doc } from './person-sync.ts'

export interface DeletionMove { type: string; event: string; eventSanityId: string; survivorId: string; survivorSlug: string }

/** Person → event edges: INVOLVED_IN (Incident), PARTICIPATED_IN (Operation). */
const EVENT_EDGES = new Set(['INVOLVED_IN', 'PARTICIPATED_IN'])

export interface DeletionPlan {
  sanityId: string
  slug:     string
  name:     string | null
  blockers: string[]
  moves:    DeletionMove[]
  drops:    string[]
}

interface EdgeRow {
  type: string
  out: boolean
  label: string
  other: string | null
  otherSanityId: string | null
  url: string | null
  props: Record<string, unknown>
}

const isSanityRef = (ref: unknown) => typeof ref === 'string' && ref.startsWith('sanity')

async function fetchEvents(ids: string[]): Promise<Map<string, string[]>> {
  if (!ids.length) return new Map()
  const url = new URL(API)
  url.searchParams.set('query', `*[_id in $ids]{_id, "people": people[]._ref}`)
  url.searchParams.set('$ids', JSON.stringify(ids))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sanity ${res.status}`)
  const docs = (await res.json() as { result: { _id: string; people: string[] | null }[] }).result
  return new Map(docs.map(d => [d._id, d.people ?? []]))
}

export async function planDeletions(driver: Driver, graphIds: Map<string, string>, sanity: Map<string, Doc>): Promise<DeletionPlan[]> {
  const gone = [...graphIds].filter(([id]) => !sanity.has(id))
  if (!gone.length) return []
  const session = driver.session()
  try {
    const plans: DeletionPlan[] = []
    for (const [sanityId, slug] of gone) {
      const r = await session.run(`
        MATCH (p:Person {sanityId: $id})
        OPTIONAL MATCH (p)-[r]-(o)
        RETURN p.canonicalName AS name, p.description_sourceRef AS descRef,
               [x IN collect(CASE WHEN r IS NULL THEN NULL ELSE {
                 type: type(r), out: startNode(r) = p, label: labels(o)[0],
                 other: coalesce(o.slug, o.id), otherSanityId: o.sanityId, url: o.url, props: properties(r)} END)
                WHERE x IS NOT NULL] AS edges`, { id: sanityId })
      const rec = r.records[0]
      const descRef = rec.get('descRef') as string | null
      const edges = rec.get('edges') as EdgeRow[]
      const plan: DeletionPlan = { sanityId, slug, name: rec.get('name') as string | null, blockers: [], moves: [], drops: [] }

      for (const e of edges) {
        const what = `${e.out ? '→' : '←'} ${e.type} ${e.label} ${e.other}`
        const derived =
          (e.type === 'RANK' && isSanityRef(e.props.sourceRef)) ||
          (e.type === 'REFERENCED_IN' && e.out && e.props.sourceRef == null) ||
          (e.type === 'HAS_IMAGE' && e.out && !!e.url?.startsWith('https://cdn.sanity.io/')
            && Object.keys(e.props).every(k => k === 'order' || k === 'caption')) ||
          (e.type === 'HAS_CONTENT' && e.out && isSanityRef(descRef)) ||
          (EVENT_EDGES.has(e.type) && e.out && isSanityRef(e.props.sourceRef)) ||
          (e.type !== 'MENTIONS' && isSanityRef(e.props.sourceRef))
        if (!derived) plan.blockers.push(what)
        else if (!EVENT_EDGES.has(e.type)) plan.drops.push(what)
      }
      plans.push(plan)

      // Event edges: move to the survivor where Sanity shows one.
      const involved = plan.blockers.length ? [] : edges.filter(e => EVENT_EDGES.has(e.type) && e.out)
      const events = await fetchEvents(involved.map(e => e.otherSanityId).filter((x): x is string => !!x))
      for (const e of involved) {
        const now = e.otherSanityId ? events.get(e.otherSanityId) : undefined
        const onEvent = new Set((await session.run(`
          MATCH (q:Person)-[:INVOLVED_IN|PARTICIPATED_IN]->(x {sanityId: $eid}) RETURN collect(q.sanityId) AS ids`,
          { eid: e.otherSanityId })).records[0].get('ids') as string[])
        const candidates = (now ?? []).filter(id => graphIds.has(id) && sanity.has(id) && !onEvent.has(id))
        if (candidates.length === 1) {
          plan.moves.push({ type: e.type, event: e.other!, eventSanityId: e.otherSanityId!, survivorId: candidates[0], survivorSlug: graphIds.get(candidates[0])! })
        } else {
          plan.drops.push(`→ ${e.type} ${e.label} ${e.other}${now ? (candidates.length ? ` (${candidates.length} candidates)` : '') : ' (event gone in Sanity)'}`)
        }
      }
    }
    return plans
  } finally {
    await session.close()
  }
}

/** One transaction per person: move event edges, then delete the person and its own descriptions. */
export function deletionStmts(plan: DeletionPlan): { text: string; params: Record<string, unknown> }[] {
  return [
    {
      // One statement per edge type — Cypher can't parameterise a relationship type.
      text: `UNWIND $moves AS m
             MATCH (p:Person {sanityId: $id})-[r:INVOLVED_IN]->(e {sanityId: m.eventSanityId})
             MATCH (s:Person {sanityId: m.survivorId})
             WHERE NOT (s)-[:INVOLVED_IN]->(e)
             CREATE (s)-[n:INVOLVED_IN]->(e) SET n = properties(r)`,
      params: { id: plan.sanityId, moves: plan.moves.filter(m => m.type === 'INVOLVED_IN') },
    },
    {
      text: `UNWIND $moves AS m
             MATCH (p:Person {sanityId: $id})-[r:PARTICIPATED_IN]->(e {sanityId: m.eventSanityId})
             MATCH (s:Person {sanityId: m.survivorId})
             WHERE NOT (s)-[:PARTICIPATED_IN]->(e)
             CREATE (s)-[n:PARTICIPATED_IN]->(e) SET n = properties(r)`,
      params: { id: plan.sanityId, moves: plan.moves.filter(m => m.type === 'PARTICIPATED_IN') },
    },
    {
      text: `MATCH (p:Person {sanityId: $id})
             OPTIONAL MATCH (p)-[:HAS_CONTENT]->(d:Description) DETACH DELETE d
             WITH DISTINCT p DETACH DELETE p`,
      params: { id: plan.sanityId },
    },
  ]
}

export function deletionSummary(p: DeletionPlan): string {
  const parts = [
    ...p.moves.map(m => `${m.event} → ${m.survivorSlug}`),
    ...(p.blockers.length ? [`BLOCKED: ${p.blockers.join('; ')}`] : []),
  ]
  return `${p.slug} (${p.name ?? '—'}): ${parts.length ? parts.join(', ') : 'nothing moves'}; drops ${p.drops.length}`
}
