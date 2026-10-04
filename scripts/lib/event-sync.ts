/**
 * Sanity `event` ↔ graph comparison (docs/SANITY-SYNC.md, "Events").
 *
 * A Sanity event lives in the graph as an Operation or an Incident with the
 * same `sanityId`; the label is the graph's own (classification), so it is
 * never compared. Every other field is reduced to a comparable string, on
 * both sides, the way the import made it (migration/src/linge/events.clj,
 * external_sources.clj, galleries.clj):
 *
 *   title         → codeName (Operation) / title (Incident)
 *   slug, date    → slug, date
 *   organization  → ORCHESTRATED_BY,  district → IN_DISTRICT
 *   locationFrom/To → FROM / TO,      stationFrom/To → FROM_STATION / TO_STATION
 *   people[]      → PARTICIPATED_IN / INVOLVED_IN,  transport[] → USED
 *   gallery[]     → HAS_IMAGE (Sanity CDN Sources),  links[] → REFERENCED_IN
 *   description   → (event)-[:HAS_CONTENT]->(:Description {id: 'desc:event:<sanityId>'})
 *                   (read from the older (Description)-[:ABOUT]->(event) shape too)
 *
 * References compare as the target's sanityId; ones the graph can't resolve
 * are left out. People count only the import's links (editor additions are
 * kept apart). `movie` was never imported.
 *
 * Baseline per field: the stamp `<field>_sha` on the node — the value last
 * taken in from Sanity. Before an event is stamped, the baseline file when
 * its _updatedAt equals the node's sanityUpdatedAt.
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { stableJson } from './sanity-sha.ts'
import type { Lookups } from './event-rule.ts'
import { isImportableUrl } from './person-rule.ts'
import { API, neo4jDriver, type Doc } from './person-sync.ts'

/** The Sanity events the graph last took in whole: the re-import of 2026-10-02
 *  (scripts/sync/reimport-events.ts). Before it, the April export. */
export const EVENT_BASELINE = 'data/sanity-baseline-2026-10/sanity-event.json'

/** Sanity events that are not events: Jan's template for new WT stations. */
export const EXCLUDED_EVENT_SLUGS = new Set(['wt-stationmal'])

export interface GraphEvent {
  sanityId:        string
  sanityUpdatedAt: string | null
  label:           'Operation' | 'Incident'
  slug:            string
  name:            string | null
  date:            string | null
  organization:    string[]
  district:        string[]
  locationFrom:    string[]
  locationTo:      string[]
  stationFrom:     string[]
  stationTo:       string[]
  /** People linked by the import (sourceRef sanity…) — editor additions are kept apart. */
  people:          string[]
  transport:       string[]
  images:          string[]
  /** Links not added in the editor. */
  links:           string[]
  description:     string | null
  /** `<field>_sha` — the field's value as last taken in from Sanity. */
  stamps:          Record<string, string>
}

const ws  = (s: string) => s.replace(/\s+/g, ' ').trim()
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
const ref = (v: unknown): string => str((v as { _ref?: string } | undefined)?._ref)
const refs = (v: unknown): string[] => ((v as { _ref?: string }[] | undefined) ?? []).map(r => r?._ref ?? '').filter(Boolean)
const set = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort().join('\n')
export const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** image-<hash>-<WxH>-<ext> → <hash>-<WxH>.<ext>, the tail of the CDN url. */
function imageKey(r: string): string {
  const m = /^image-([a-f0-9]+-\d+x\d+)-(\w+)$/.exec(r)
  return m ? `${m[1]}.${m[2]}` : r
}

export interface EventField {
  name: string
  /** Comparable Sanity value. References the graph can't resolve yet are left out —
   *  when the target arrives, the value changes and the link is added as a Sanity change. */
  fromSanity: (d: Doc, l: Lookups) => string
  fromGraph:  (g: GraphEvent) => string
}

const known = (l: Lookups, label: keyof Lookups) => (id: string) => l[label].has(id)
const one = (field: string, label: keyof Lookups) =>
  (d: Doc, l: Lookups) => { const id = ref(d[field]); return id && known(l, label)(id) ? id : '' }

export const EVENT_FIELDS: EventField[] = [
  { name: 'title',        fromSanity: d => ws(str(d.title)),   fromGraph: g => ws(g.name ?? '') },
  { name: 'slug',         fromSanity: d => str((d.slug as { current?: string } | undefined)?.current), fromGraph: g => g.slug },
  { name: 'date',         fromSanity: d => str(d.date),        fromGraph: g => g.date ?? '' },
  { name: 'organization', fromSanity: one('organization', 'Organization'), fromGraph: g => set(g.organization) },
  { name: 'district',     fromSanity: one('district', 'Unit'),             fromGraph: g => set(g.district) },
  { name: 'locationFrom', fromSanity: one('locationFrom', 'Location'),     fromGraph: g => set(g.locationFrom) },
  { name: 'locationTo',   fromSanity: one('locationTo', 'Location'),       fromGraph: g => set(g.locationTo) },
  { name: 'stationFrom',  fromSanity: one('stationFrom', 'Station'),       fromGraph: g => set(g.stationFrom) },
  { name: 'stationTo',    fromSanity: one('stationTo', 'Station'),         fromGraph: g => set(g.stationTo) },
  { name: 'people',       fromSanity: (d, l) => set(refs(d.people).filter(known(l, 'Person'))),       fromGraph: g => set(g.people) },
  { name: 'transport',    fromSanity: (d, l) => set(refs(d.transport).filter(known(l, 'Transport'))), fromGraph: g => set(g.transport) },
  { name: 'gallery',
    fromSanity: d => set(((d.gallery as { asset?: { _ref?: string } }[] | undefined) ?? []).map(i => imageKey(i.asset?._ref ?? ''))),
    fromGraph:  g => set(g.images) },
  { name: 'links',
    fromSanity: d => set(((d.links as { link?: string }[] | undefined) ?? []).map(l => l.link ?? '').filter(isImportableUrl)),
    fromGraph:  g => set(g.links) },
  { name: 'description',
    fromSanity: d => (d.description ? stableJson(d.description) : ''),
    fromGraph:  g => (g.description ? stableJson(JSON.parse(g.description)) : '') },
]

/** A field's baseline: its stamp, or — before the event is stamped — the baseline file's value. */
export function baselineSha(g: GraphEvent, f: EventField, base: Doc | undefined, l: Lookups): string | undefined {
  return g.stamps[`${f.name}_sha`] ?? (base && base._updatedAt === g.sanityUpdatedAt ? sha(f.fromSanity(base, l)) : undefined)
}

/** Stamps to write when the graph has taken `d` in. */
export function stampsFor(d: Doc, l: Lookups): Record<string, string> {
  return Object.fromEntries(EVENT_FIELDS.map(f => [`${f.name}_sha`, sha(f.fromSanity(d, l))]))
}

export type EventVerdict = 'already' | 'clean' | 'conflict' | 'review'

/**
 * Per field Sanity changed: the field's stamp is the baseline (or, before
 * the event is stamped, the baseline file when its _updatedAt matches).
 *   already   the graph holds the new value
 *   clean     the graph still holds the baseline → apply
 *   conflict  the graph was edited too → review bundle
 *   review    no baseline at all
 */
export function classifyEvent(g: GraphEvent, s: Doc, base: Doc | undefined, l: Lookups): { field: string; verdict: EventVerdict }[] {
  const out: { field: string; verdict: EventVerdict }[] = []
  for (const f of EVENT_FIELDS) {
    const now = f.fromSanity(s, l), graph = f.fromGraph(g)
    const stamp = baselineSha(g, f, base, l)
    if (stamp === undefined) {
      if (graph !== now) out.push({ field: f.name, verdict: 'review' })
      continue
    }
    if (sha(now) === stamp) continue
    out.push({ field: f.name, verdict: graph === now ? 'already' : sha(graph) === stamp ? 'clean' : 'conflict' })
  }
  return out
}

/** Events Sanity hasn't changed: the graph must still equal its stamps (or the baseline file). */
export function calibrateEvents(graph: Map<string, GraphEvent>, sanity: Map<string, Doc>, base: Map<string, Doc>, l: Lookups) {
  const checks: Record<string, { agree: number; total: number; samples: unknown[] }> = {}
  for (const g of graph.values()) {
    const s = sanity.get(g.sanityId), b = base.get(g.sanityId)
    if (!s) continue
    for (const f of EVENT_FIELDS) {
      const stamp = baselineSha(g, f, b, l)
      if (stamp === undefined || sha(f.fromSanity(s, l)) !== stamp) continue   // no baseline, or Sanity changed
      const c = (checks[f.name] ??= { agree: 0, total: 0, samples: [] })
      c.total++
      if (sha(f.fromGraph(g)) === stamp) c.agree++
      else if (c.samples.length < 5) c.samples.push({ slug: g.slug, graph: f.fromGraph(g).slice(0, 200), sanity: f.fromSanity(s, l).slice(0, 200) })
    }
  }
  return checks
}

// ── Data ──

export const loadAprilEvents = (): Map<string, Doc> =>
  new Map((JSON.parse(readFileSync(EVENT_BASELINE, 'utf8')) as Doc[]).map(d => [d._id, d]))

export async function fetchSanityEvents(): Promise<Doc[]> {
  const out: Doc[] = []
  let lastId = ''
  for (;;) {
    const url = new URL(API)
    url.searchParams.set('query',
      `*[_type == "event" && !(_id in path("drafts.**")) && _id > $lastId] | order(_id asc) [0...1000]`)
    url.searchParams.set('$lastId', JSON.stringify(lastId))
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Sanity ${res.status}`)
    const page = (await res.json() as { result: Doc[] }).result
    out.push(...page.filter(d => !EXCLUDED_EVENT_SLUGS.has(str((d.slug as { current?: string } | undefined)?.current))))
    if (page.length < 1000) return out
    lastId = page[page.length - 1]._id
  }
}

export async function fetchGraphEvents(): Promise<Map<string, GraphEvent>> {
  const driver = neo4jDriver()
  const session = driver.session()
  try {
    const r = await session.run(`
      MATCH (e) WHERE (e:Operation OR e:Incident) AND e.sanityId IS NOT NULL
      RETURN e.sanityId AS sanityId, e.sanityUpdatedAt AS sanityUpdatedAt,
             CASE WHEN e:Operation THEN 'Operation' ELSE 'Incident' END AS label,
             e.slug AS slug, coalesce(e.codeName, e.title) AS name, e.date AS date,
             [(e)-[:ORCHESTRATED_BY]->(x) | x.sanityId] AS organization,
             [(e)-[:IN_DISTRICT]->(x)     | x.sanityId] AS district,
             [(e)-[:FROM]->(x)            | x.sanityId] AS locationFrom,
             [(e)-[:TO]->(x)              | x.sanityId] AS locationTo,
             [(e)-[:FROM_STATION]->(x)    | x.sanityId] AS stationFrom,
             [(e)-[:TO_STATION]->(x)      | x.sanityId] AS stationTo,
             [(p:Person)-[r:PARTICIPATED_IN|INVOLVED_IN]->(e) WHERE coalesce(r.sourceRef, '') STARTS WITH 'sanity' | p.sanityId] AS people,
             [(e)-[:USED]->(t:Transport)  | t.sanityId] AS transport,
             [(e)-[:HAS_IMAGE]->(s:Source) WHERE s.url STARTS WITH 'https://cdn.sanity.io/' | last(split(s.url, '/'))] AS images,
             [(e)-[r:REFERENCED_IN]->(s:Source) WHERE s.url IS NOT NULL AND coalesce(r.sourceRef, '') <> 'admin-edit' | s.url] AS links,
             head([(e)-[:HAS_CONTENT]->(d:Description) WHERE d.id = 'desc:event:' + e.sanityId | d.content]
                  + [(d:Description)-[:ABOUT]->(e) WHERE d.id = 'desc:event:' + e.sanityId | d.content]) AS description,
             [k IN keys(e) WHERE k ENDS WITH '_sha' | [k, e[k]]] AS stampPairs`)
    return new Map(r.records.map(rec => {
      const { stampPairs, ...rest } = rec.toObject() as Omit<GraphEvent, 'stamps'> & { stampPairs: [string, string][] }
      const g: GraphEvent = { ...rest, stamps: Object.fromEntries(stampPairs) }
      return [g.sanityId, g]
    }))
  } finally {
    await session.close()
    await driver.close()
  }
}
