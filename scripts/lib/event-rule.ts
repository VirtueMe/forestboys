/**
 * The Sanity event → graph rule (migration/src/linge/events.clj,
 * external_sources.clj, galleries.clj), as Operations. Shared by the
 * re-import (scripts/reimport-events.ts) and the sync (scripts/sync-event.ts).
 *
 *   node      slug, codeName (title), date, type 'unclassified', sanityId, sanityUpdatedAt
 *   edges     ORCHESTRATED_BY, IN_DISTRICT, FROM, TO, FROM_STATION, TO_STATION, USED,
 *             Person PARTICIPATED_IN {state: 'verified', sourceRef: 'sanity-event-migration'}
 *   images    HAS_IMAGE {order, caption?} → Source img:sanity:<asset>
 *   links     REFERENCED_IN → Source (person-rule linkSource)
 *   text      (:Description {id: 'desc:event:<id>', …})-[:ABOUT]->
 *
 * References resolve by sanityId to the target's slug; one the graph lacks
 * is left out (and reported).
 */

import type { ManagedTransaction, Session } from 'neo4j-driver'
import { imageSources, isImportableUrl, linkSource, type ImageSource, type LinkSource } from './person-rule.ts'
import type { Doc } from './person-sync.ts'

export const str  = (v: unknown): string => (typeof v === 'string' ? v : '')
export const ref  = (v: unknown): string => str((v as { _ref?: string } | undefined)?._ref)
export const refs = (v: unknown): string[] =>
  [...new Set(((v as { _ref?: string }[] | undefined) ?? []).map(r => r?._ref ?? '').filter(Boolean))]
export const slugOf = (d: Doc) => str((d.slug as { current?: string } | undefined)?.current)

/** Single-target reference fields → edge type and target label. */
export const SINGLE: { field: string; type: string; label: string }[] = [
  { field: 'organization', type: 'ORCHESTRATED_BY', label: 'Organization' },
  { field: 'district',     type: 'IN_DISTRICT',     label: 'Unit' },
  { field: 'locationFrom', type: 'FROM',            label: 'Location' },
  { field: 'locationTo',   type: 'TO',              label: 'Location' },
  { field: 'stationFrom',  type: 'FROM_STATION',    label: 'Station' },
  { field: 'stationTo',    type: 'TO_STATION',      label: 'Station' },
]

export const PARTICIPANT_EDGE = { state: 'verified', sourceRef: 'sanity-event-migration' } as const

/** sanityId → slug, per label an event can point at. */
export type Lookups = Record<'Organization' | 'Unit' | 'Location' | 'Station' | 'Transport' | 'Person', Map<string, string>>

export async function loadLookups(session: Session): Promise<Lookups> {
  const out = {} as Lookups
  for (const label of ['Organization', 'Unit', 'Location', 'Station', 'Transport', 'Person'] as const) {
    const r = await session.run(`MATCH (n:\`${label}\`) WHERE n.sanityId IS NOT NULL AND n.slug IS NOT NULL RETURN n.sanityId AS id, n.slug AS slug`)
    out[label] = new Map(r.records.map(x => [x.get('id') as string, x.get('slug') as string]))
  }
  return out
}

export type EventImage = Omit<ImageSource, 'caption'> & { caption: string | null }

export interface EventPlan {
  sanityId:     string
  node:         Record<string, unknown>
  single:       { type: string; label: string; target: string }[]
  people:       string[]   // person slugs
  transport:    string[]   // transport slugs
  images:       EventImage[]
  links:        LinkSource[]
  description:  Record<string, unknown> | null
  unresolved:   { field: string; id: string }[]
}

export function descriptionProps(d: Doc): Record<string, unknown> | null {
  if (!Array.isArray(d.description) || !d.description.length) return null
  return {
    id: `desc:event:${d._id}`, content: JSON.stringify(d.description), order: 1,
    recordedDate: d._updatedAt, author: 'sanity-event-migration', confidence: 'verified', sanityEventId: d._id,
  }
}

export function eventLinks(d: Doc): LinkSource[] {
  const titles = new Map(((d.links as { link?: string; title?: string }[] | undefined) ?? []).map(l => [l.link ?? '', l.title]))
  return [...new Set([...titles.keys()].filter(isImportableUrl))].map(url => linkSource(url, titles.get(url)))
}

export function eventImages(d: Doc): EventImage[] {
  return imageSources(d.gallery).map(i => ({ ...i, caption: i.caption ?? null }))
}

export function planEvent(d: Doc, lookups: Lookups): EventPlan {
  const node: Record<string, unknown> = {
    slug: slugOf(d), codeName: str(d.title), type: 'unclassified', sanityId: d._id, sanityUpdatedAt: d._updatedAt,
  }
  if (str(d.date)) node.date = d.date
  const unresolved: EventPlan['unresolved'] = []
  const single: EventPlan['single'] = []
  for (const s of SINGLE) {
    const id = ref(d[s.field])
    if (!id) continue
    const target = lookups[s.label as keyof Lookups].get(id)
    if (target) single.push({ type: s.type, label: s.label, target })
    else unresolved.push({ field: s.field, id })
  }
  const resolveAll = (field: string, ids: string[], map: Map<string, string>) => ids.flatMap(id => {
    const t = map.get(id)
    if (!t) unresolved.push({ field, id })
    return t ? [t] : []
  })
  return {
    sanityId: d._id, node, single,
    people:    resolveAll('people', refs(d.people), lookups.Person),
    transport: resolveAll('transport', refs(d.transport), lookups.Transport),
    images:    eventImages(d),
    links:     eventLinks(d),
    description: descriptionProps(d),
    unresolved,
  }
}

/** Create one event from its plan (the sync's new events; the re-import batches the same writes). */
export async function writeEvent(tx: ManagedTransaction, p: EventPlan, stamps: Record<string, string>): Promise<void> {
  const id = p.sanityId
  await tx.run(`CREATE (e:Operation) SET e = $node, e += $stamps`, { node: p.node, stamps })
  for (const s of p.single) {
    await tx.run(`MATCH (e:Operation {sanityId: $id}), (t:\`${s.label}\` {slug: $target}) MERGE (e)-[:\`${s.type}\`]->(t)`, { id, target: s.target })
  }
  await tx.run(`
    MATCH (e:Operation {sanityId: $id}) UNWIND $people AS slug MATCH (p:Person {slug: slug})
    MERGE (p)-[r:PARTICIPATED_IN]->(e) SET r += $edge`, { id, people: p.people, edge: PARTICIPANT_EDGE })
  await tx.run(`
    MATCH (e:Operation {sanityId: $id}) UNWIND $transport AS slug MATCH (t:Transport {slug: slug})
    MERGE (e)-[:USED]->(t)`, { id, transport: p.transport })
  await tx.run(`
    MATCH (e:Operation {sanityId: $id}) UNWIND $images AS img
    MERGE (s:Source {id: img.id}) ON CREATE SET s.type = 'photograph', s.url = img.url, s.sanityAssetRef = img.assetRef
    MERGE (e)-[h:HAS_IMAGE]->(s) SET h.order = img.order, h.caption = img.caption`, { id, images: p.images })
  await tx.run(`
    MATCH (e:Operation {sanityId: $id}) UNWIND $links AS src
    MERGE (s:Source {id: src.id}) ON CREATE SET s += src
    MERGE (e)-[:REFERENCED_IN]->(s)`, { id, links: p.links })
  if (p.description) {
    await tx.run(`MATCH (e:Operation {sanityId: $id}) CREATE (d:Description)-[:ABOUT]->(e) SET d = $props`, { id, props: p.description })
  }
}
