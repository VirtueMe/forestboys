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
 *   description   → (:Description {id: 'desc:event:<sanityId>'})-[:ABOUT]->
 *
 * References compare as the target's sanityId. `movie` was never imported.
 *
 * Baseline per event: the April export, when its _updatedAt equals the
 * node's sanityUpdatedAt; otherwise none (review).
 */

import { readFileSync } from 'node:fs'
import { stableJson } from './sanity-sha.ts'
import { isImportableUrl } from './person-rule.ts'
import { API, neo4jDriver, type Doc } from './person-sync.ts'

/** The Sanity events the graph last took in whole: the re-import of 2026-10-02
 *  (scripts/reimport-events.ts). Before it, the April export. */
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
  people:          string[]
  transport:       string[]
  images:          string[]
  links:           string[]
  description:     string | null
}

const ws  = (s: string) => s.replace(/\s+/g, ' ').trim()
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
const ref = (v: unknown): string => str((v as { _ref?: string } | undefined)?._ref)
const refs = (v: unknown): string[] => ((v as { _ref?: string }[] | undefined) ?? []).map(r => r?._ref ?? '').filter(Boolean)
const set = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort().join('\n')

/** image-<hash>-<WxH>-<ext> → <hash>-<WxH>.<ext>, the tail of the CDN url. */
function imageKey(r: string): string {
  const m = /^image-([a-f0-9]+-\d+x\d+)-(\w+)$/.exec(r)
  return m ? `${m[1]}.${m[2]}` : r
}

export interface EventField {
  name: string
  fromSanity: (d: Doc) => string
  fromGraph:  (g: GraphEvent) => string
}

export const EVENT_FIELDS: EventField[] = [
  { name: 'title',        fromSanity: d => ws(str(d.title)),   fromGraph: g => ws(g.name ?? '') },
  { name: 'slug',         fromSanity: d => str((d.slug as { current?: string } | undefined)?.current), fromGraph: g => g.slug },
  { name: 'date',         fromSanity: d => str(d.date),        fromGraph: g => g.date ?? '' },
  { name: 'organization', fromSanity: d => ref(d.organization), fromGraph: g => set(g.organization) },
  { name: 'district',     fromSanity: d => ref(d.district),     fromGraph: g => set(g.district) },
  { name: 'locationFrom', fromSanity: d => ref(d.locationFrom), fromGraph: g => set(g.locationFrom) },
  { name: 'locationTo',   fromSanity: d => ref(d.locationTo),   fromGraph: g => set(g.locationTo) },
  { name: 'stationFrom',  fromSanity: d => ref(d.stationFrom),  fromGraph: g => set(g.stationFrom) },
  { name: 'stationTo',    fromSanity: d => ref(d.stationTo),    fromGraph: g => set(g.stationTo) },
  { name: 'people',       fromSanity: d => set(refs(d.people)),    fromGraph: g => set(g.people) },
  { name: 'transport',    fromSanity: d => set(refs(d.transport)), fromGraph: g => set(g.transport) },
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

export type EventVerdict = 'already' | 'clean' | 'conflict' | 'review'

/** Per changed field: compare current Sanity with the baseline, and the graph with both. */
export function classifyEvent(g: GraphEvent, s: Doc, april: Doc | undefined): { field: string; verdict: EventVerdict }[] {
  const base = april && april._updatedAt === g.sanityUpdatedAt ? april : null
  const out: { field: string; verdict: EventVerdict }[] = []
  for (const f of EVENT_FIELDS) {
    const now = f.fromSanity(s), graph = f.fromGraph(g)
    const changed = base ? now !== f.fromSanity(base) : graph !== now
    if (!changed) continue
    out.push({
      field: f.name,
      verdict: graph === now ? 'already' : !base ? 'review' : graph === f.fromSanity(base) ? 'clean' : 'conflict',
    })
  }
  return out
}

/** Unchanged in Sanity since April with a trustworthy baseline: the graph must equal the baseline. */
export function calibrateEvents(graph: Map<string, GraphEvent>, sanity: Map<string, Doc>, april: Map<string, Doc>) {
  const checks: Record<string, { agree: number; total: number; samples: unknown[] }> = {}
  for (const g of graph.values()) {
    const b = april.get(g.sanityId), s = sanity.get(g.sanityId)
    if (!b || !s || s._updatedAt !== b._updatedAt || b._updatedAt !== g.sanityUpdatedAt) continue
    for (const f of EVENT_FIELDS) {
      const c = (checks[f.name] ??= { agree: 0, total: 0, samples: [] })
      c.total++
      if (f.fromGraph(g) === f.fromSanity(b)) c.agree++
      else if (c.samples.length < 5) c.samples.push({ slug: g.slug, graph: f.fromGraph(g).slice(0, 200), sanity: f.fromSanity(b).slice(0, 200) })
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
             [(p:Person)-[:PARTICIPATED_IN|INVOLVED_IN]->(e) | p.sanityId] AS people,
             [(e)-[:USED]->(t:Transport)  | t.sanityId] AS transport,
             [(e)-[:HAS_IMAGE]->(s:Source) WHERE s.url STARTS WITH 'https://cdn.sanity.io/' | last(split(s.url, '/'))] AS images,
             [(e)-[:REFERENCED_IN]->(s:Source) WHERE s.url IS NOT NULL | s.url] AS links,
             head([(d:Description)-[:ABOUT]->(e) WHERE d.id = 'desc:event:' + e.sanityId | d.content]) AS description`)
    return new Map(r.records.map(rec => {
      const g = rec.toObject() as GraphEvent
      return [g.sanityId, g]
    }))
  } finally {
    await session.close()
    await driver.close()
  }
}
