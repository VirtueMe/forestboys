/**
 * Strategies for stays — `(:Person)-[:STATIONED_AT]->(:Location | :Station)`
 * (docs/PERSON-STATIONED-AT.md). One entry per edge: a person can have
 * several stays at the same place, so entries carry `edgeId` and notes
 * are keyed by it (`/api/admin/stay-note/:stayId`). Shared edge-entry
 * plumbing lives in ./edgeEntries.ts.
 *
 * Location and Station share some slugs, so on the Person side a place's
 * `targetSlug` is `<kind>:<slug>`.
 */

import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { usePlaceRoute } from '@/composables/usePlaceRoute.ts'
import type { RelationEntry, RelationStrategy, RelationTarget } from './RelationStrategy.ts'
import { edgeEntriesCypher, edgeRowToEntry, saveEdgeEntries, saveEdgeNote, type EdgeEntryRow } from './edgeEntries.ts'

export type PlaceKind = 'location' | 'station'

const PLACE_LABEL: Record<PlaceKind, string> = { location: 'Location', station: 'Station' }

interface StayRow extends EdgeEntryRow { role: string | null }

function staysCypher(match: string, target: string): string {
  return edgeEntriesCypher({
    match, noteEdge: 'HAS_STATIONED_NOTE', keyProp: 'stayId',
    returns: `${target}, r.role AS role, r.startDate AS startDate, r.endDate AS endDate`,
  })
}

const rowToEntry = (r: StayRow): RelationEntry => ({ ...edgeRowToEntry(r), role: r.role ?? null })

function stayFields(e: RelationEntry) {
  return {
    id:        e.edgeId ?? null,
    role:      e.role ?? null,
    startDate: e.startDate,
    endDate:   e.endDate,
    sourceRefs: e.sourceRefs ?? [],
  }
}

const saveStayNote = (stayId: string, sections: Parameters<typeof saveEdgeNote>[1]) =>
  saveEdgeNote(`/api/admin/stay-note/${encodeURIComponent(stayId)}`, sections)

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
        '(p:Person {slug: $slug})-[r:STATIONED_AT]->(t)',
        `CASE WHEN t:Station THEN 'station:' ELSE 'location:' END + t.slug AS targetSlug,
         coalesce(t.canonicalName, t.title) AS targetName`,
      ),
      { slug: personSlug },
    )
    return rows.map(rowToEntry)
  },
  saveEntries(personSlug, entries) {
    return saveEdgeEntries(
      `/api/admin/person/${encodeURIComponent(personSlug)}/stays`, 'stays',
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
          `(p:Person)-[r:STATIONED_AT]->(t:${PLACE_LABEL[kind]} {slug: $slug})`,
          'p.slug AS targetSlug, p.canonicalName AS targetName',
        ),
        { slug: placeSlug },
      )
      return rows.map(rowToEntry)
    },
    saveEntries(placeSlug, entries) {
      return saveEdgeEntries(
        `/api/admin/${kind}/${encodeURIComponent(placeSlug)}/stays`, 'stays',
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
