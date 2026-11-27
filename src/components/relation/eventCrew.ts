/**
 * Event crew — who served on each transport during one Operation or Incident
 * (CrewAssignment nodes, functions/_lib/event-crew.ts). The crew is part of
 * the event's transport list: each transport entry carries its rows in
 * `crew` (`edgeId` is the assignment id) and the list saves them with it.
 */

import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { comparePartial } from '../../../functions/_lib/period.ts'
import type { RelationEntry, RelationStrategy } from './RelationStrategy.ts'
import { saveEdgeEntries } from './edgeEntries.ts'
import { EventTransportStrategy } from './strategies.ts'

interface Row {
  transportSlug: string
  id:            string
  personSlug:    string
  personName:    string
  role:          string | null
}

function crewEntry(slug: string, name: string, role: string | null, id: string | null): RelationEntry {
  return {
    edgeId: id, targetSlug: slug, targetName: name, role,
    startDate: null, endDate: null, sections: [], hasDescription: false,
  }
}

async function fetchCrew(eventSlug: string): Promise<Row[]> {
  return neo4jQuery<Row>(`
    MATCH (p:Person)-[:SERVED_AS]->(a:CrewAssignment)-[:ON_EVENT]->(e {slug: $slug}), (a)-[:ABOARD]->(t:Transport)
    WHERE (e:Operation OR e:Incident) AND (e)-[:USED]->(t) AND (p)-[:PARTICIPATED_IN|INVOLVED_IN]->(e)
    RETURN t.slug AS transportSlug, a.id AS id, p.slug AS personSlug, p.canonicalName AS personName, a.role AS role
    ORDER BY coalesce(a.order, 999), personName
  `, { slug: eventSlug })
}

export const EventTransportCrewStrategy: RelationStrategy = {
  ...EventTransportStrategy,
  async fetchEntries(eventSlug) {
    const [entries, rows] = await Promise.all([EventTransportStrategy.fetchEntries(eventSlug), fetchCrew(eventSlug)])
    return entries.map(e => ({
      ...e,
      crew: rows.filter(r => r.transportSlug === e.targetSlug).map(r => crewEntry(r.personSlug, r.personName, r.role, r.id)),
    }))
  },
  async saveEntries(eventSlug, entries) {
    // Checked first, so an unfinished crew row saves nothing at all.
    if (entries.some(e => e.crew?.some(c => !c.targetSlug))) throw new Error('Velg person på alle mannskapsrader før du lagrer.')
    await EventTransportStrategy.saveEntries(eventSlug, entries)
    for (const t of entries) {
      if (!t.crew) continue
      await saveEdgeEntries(
        `/api/admin/event/${encodeURIComponent(eventSlug)}/crew`, 'crew',
        t.crew,
        t.crew.map(c => ({ id: c.edgeId ?? null, personSlug: c.targetSlug, role: c.role ?? null })),
        { transportSlug: t.targetSlug },
      )
    }
  },
}

/**
 * Rows to add from a transport's regular crew: the stints whose period covers `date` (an open or equally coarse end
 * counts), less what the list already has. A person with two stints in the same role is added once.
 */
export function regularCrewOn(regular: RelationEntry[], date: string, have: RelationEntry[]): RelationEntry[] {
  const key  = (e: RelationEntry) => `${e.targetSlug}\n${e.role ?? ''}`
  const seen = new Set(have.map(key))
  const out: RelationEntry[] = []
  for (const r of regular) {
    if (r.startDate && comparePartial(r.startDate, date) > 0) continue
    if (r.endDate && comparePartial(r.endDate, date) < 0) continue
    if (seen.has(key(r))) continue
    seen.add(key(r))
    out.push(crewEntry(r.targetSlug, r.targetName, r.role ?? null, null))
  }
  return out
}
