/**
 * Crew of a Transport — `(:Person)-[:CREW_OF]->(:Transport)`, one entry per
 * edge (`edgeId`): a person can serve twice or change role. No notes.
 * Server side: functions/_lib/crew.ts.
 */

import { neo4jQuery } from '@/composables/useNeo4j.ts'
import type { RelationEntry, RelationStrategy, RelationTarget } from './RelationStrategy.ts'
import { saveEdgeEntries } from './edgeEntries.ts'

interface CrewRow {
  edgeId:     string
  targetSlug: string
  targetName: string
  role:       string | null
  startDate:  string | null
  endDate:    string | null
}

export const TransportCrewStrategy: RelationStrategy = {
  async fetchTargets() {
    return neo4jQuery<RelationTarget>(`
      MATCH (p:Person)
      RETURN p.slug AS slug,
             p.canonicalName + CASE WHEN p.birthYear IS NOT NULL THEN ' (' + toString(p.birthYear) + ')' ELSE '' END AS name
      ORDER BY p.canonicalName
    `)
  },
  async fetchEntries(transportSlug) {
    const rows = await neo4jQuery<CrewRow>(`
      MATCH (p:Person)-[r:CREW_OF]->(:Transport {slug: $slug})
      WHERE p.slug IS NOT NULL
      RETURN coalesce(r.id, elementId(r)) AS edgeId, p.slug AS targetSlug, p.canonicalName AS targetName,
             r.role AS role, r.startDate AS startDate, r.endDate AS endDate
      ORDER BY role, startDate, targetName
    `, { slug: transportSlug })
    return rows.map((r): RelationEntry => ({ ...r, sections: [], hasDescription: false }))
  },
  saveEntries(transportSlug, entries) {
    return saveEdgeEntries(
      `/api/admin/transport/${encodeURIComponent(transportSlug)}/crew`, 'crew',
      entries,
      entries.map(e => ({
        id:         e.edgeId ?? null,
        personSlug: e.targetSlug,
        role:       e.role ?? null,
        startDate:  e.startDate,
        endDate:    e.endDate,
      })),
    )
  },
  saveNote: () => Promise.reject(new Error('Mannskap har ingen notater')),
  targetRoute(entry) { return `/person/${entry.targetSlug}` },
}
