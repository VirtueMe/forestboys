/**
 * Strategies for stays — `(:Person)-[:STATIONED_AT]->(:Location | :Station)`
 * (docs/PERSON-STATIONED-AT.md). One entry per edge: a person can have
 * several stays at the same place, so entries carry `edgeId` and notes
 * are keyed by it (`/api/admin/stay-note/:stayId`).
 *
 * Location and Station share some slugs, so on the Person side a place's
 * `targetSlug` is `<kind>:<slug>`.
 */

import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { authFetch }  from '@/composables/useAuth.ts'
import { usePlaceRoute } from '@/composables/usePlaceRoute.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry, RelationStrategy, RelationTarget } from './RelationStrategy.ts'
import { rowToSection, type SectionRow } from './strategies.ts'

export type PlaceKind = 'location' | 'station'

const PLACE_LABEL: Record<PlaceKind, string> = { location: 'Location', station: 'Station' }

interface StayRow {
  edgeId:     string | null
  state:      string | null
  targetSlug: string
  targetName: string
  role:       string | null
  startDate:  string | null
  endDate:    string | null
  sections:   SectionRow[]
}

/**
 * `match` binds p (Person), r (STATIONED_AT), pl (place); `target` is the
 * RETURN expressions for targetSlug / targetName. Undated stays sort last.
 */
function staysCypher(match: string, target: string): string {
  return `
    MATCH ${match}
    OPTIONAL MATCH (p)-[:HAS_STATIONED_NOTE]->(d:Description {stayId: r.id})
    OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
    WITH p, r, pl, d, from
    OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
    WITH p, r, pl, d, from,
         collect(CASE WHEN src IS NULL THEN NULL ELSE {
           inline:       coalesce(cites.inline, false),
           sourceId:     src.id,
           sourceTitle:  src.title,
           sourceUrl:    src.url,
           sourceAuthor: src.authorFreeText
         } END) AS rawCites
    WITH p, r, pl,
         CASE WHEN d IS NULL THEN NULL ELSE {
           order:     coalesce(d.order, 1),
           content:   d.content,
           citations: [x IN rawCites WHERE x IS NOT NULL],
           sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
             id:             from.id,
             title:          from.title,
             url:            from.url,
             authorFreeText: from.authorFreeText,
             license:        from.license,
             attribution:    from.attribution
           } END
         } END AS section
    WITH p, r, pl, collect(section) AS rawSections
    RETURN r.id AS edgeId, r.state AS state, ${target},
           r.role AS role, r.startDate AS startDate, r.endDate AS endDate,
           [x IN rawSections WHERE x IS NOT NULL] AS sections
    ORDER BY r.startDate, targetName
  `
}

function rowToEntry(r: StayRow): RelationEntry {
  return {
    edgeId:         r.edgeId,
    state:          r.state,
    targetSlug:     r.targetSlug,
    targetName:     r.targetName,
    role:           r.role ?? null,
    startDate:      r.startDate,
    endDate:        r.endDate,
    sections:       (r.sections ?? []).map(rowToSection),
    hasDescription: (r.sections ?? []).length > 0,
  }
}

/** PATCH the stays, then copy the returned ids onto the entries (new rows get theirs here). */
async function saveStays(url: string, entries: RelationEntry[], stays: Record<string, unknown>[]): Promise<void> {
  const res = await authFetch(url, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ stays }),
  })
  const body = await res.json().catch(() => ({})) as { error?: string; ids?: string[] }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  entries.forEach((e, i) => { e.edgeId = body.ids?.[i] ?? e.edgeId })
}

function stayFields(e: RelationEntry) {
  return {
    id:        e.edgeId ?? null,
    role:      e.role ?? null,
    startDate: e.startDate,
    endDate:   e.endDate,
  }
}

async function saveStayNote(stayId: string, sections: Section[]): Promise<void> {
  const payload = {
    sections: [...sections].sort((a, b) => a.order - b.order).map(s => ({
      order:         s.order,
      content:       s.content,
      citations:     s.citations.map(c => ({ inline: c.inline, sourceId: c.source.id })),
      sourcedFromId: s.sourcedFrom?.id ?? null,
    })),
  }
  const res = await authFetch(`/api/admin/stay-note/${encodeURIComponent(stayId)}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status} on note for stay ${stayId}`)
  }
}

export function splitPlace(targetSlug: string): { kind: PlaceKind; slug: string } {
  const i = targetSlug.indexOf(':')
  return { kind: targetSlug.slice(0, i) as PlaceKind, slug: targetSlug.slice(i + 1) }
}

/** Person → places. Picker lists Locations and Stations, Stations marked. */
export const PersonStaysStrategy: RelationStrategy = {
  async fetchTargets() {
    return neo4jQuery<RelationTarget>(`
      MATCH (pl) WHERE pl:Location OR pl:Station
      RETURN CASE WHEN pl:Station THEN 'station:' ELSE 'location:' END + pl.slug AS slug,
             coalesce(pl.canonicalName, pl.title)
               + CASE WHEN pl:Station THEN ' (stasjon)' ELSE '' END AS name
      ORDER BY name
    `)
  },
  async fetchEntries(personSlug) {
    const rows = await neo4jQuery<StayRow>(
      staysCypher(
        '(p:Person {slug: $slug})-[r:STATIONED_AT]->(pl)',
        `CASE WHEN pl:Station THEN 'station:' ELSE 'location:' END + pl.slug AS targetSlug,
         coalesce(pl.canonicalName, pl.title) AS targetName`,
      ),
      { slug: personSlug },
    )
    return rows.map(rowToEntry)
  },
  saveEntries(personSlug, entries) {
    return saveStays(
      `/api/admin/person/${encodeURIComponent(personSlug)}/stays`,
      entries,
      entries.map(e => ({ place: e.targetSlug, ...stayFields(e) })),
    )
  },
  saveNote: (_personSlug, stayId, sections) => saveStayNote(stayId, sections),
  targetRoute(entry) {
    const { kind, slug } = splitPlace(entry.targetSlug)
    return kind === 'station' ? `/station/${slug}` : usePlaceRoute()(slug)
  },
}

/** Place → people, for the Location or Station page. */
export function placeStaysStrategy(kind: PlaceKind): RelationStrategy {
  return {
    async fetchTargets() {
      return neo4jQuery<RelationTarget>(`
        MATCH (p:Person)
        RETURN p.slug AS slug,
               p.canonicalName + CASE WHEN p.birthYear IS NOT NULL THEN ' (' + toString(p.birthYear) + ')' ELSE '' END AS name
        ORDER BY p.canonicalName
      `)
    },
    async fetchEntries(placeSlug) {
      const rows = await neo4jQuery<StayRow>(
        staysCypher(
          `(p:Person)-[r:STATIONED_AT]->(pl:${PLACE_LABEL[kind]} {slug: $slug})`,
          'p.slug AS targetSlug, p.canonicalName AS targetName',
        ),
        { slug: placeSlug },
      )
      return rows.map(rowToEntry)
    },
    saveEntries(placeSlug, entries) {
      return saveStays(
        `/api/admin/${kind}/${encodeURIComponent(placeSlug)}/stays`,
        entries,
        entries.map(e => ({ personSlug: e.targetSlug, ...stayFields(e) })),
      )
    },
    saveNote: (_placeSlug, stayId, sections) => saveStayNote(stayId, sections),
    targetRoute(entry) { return `/person/${entry.targetSlug}` },
  }
}

export const LocationStaysStrategy = placeStaysStrategy('location')
export const StationStaysStrategy  = placeStaysStrategy('station')

/** Row-header hint in the editor for migrated stays nobody has reviewed yet. */
export function staySummaryExtra(e: RelationEntry): string {
  return e.state === 'candidate' ? 'ikke gjennomgått' : ''
}
