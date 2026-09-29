/**
 * Relations with several edges to the same target (stays, rank history):
 * one entry per edge, keyed by the edge's `id`, each with its own note
 * `(Person)-[:<noteEdge>]->(Description {<keyProp>: r.id})`.
 * Server side: functions/_lib/edge-note.ts.
 */

import { authFetch } from '@/composables/useAuth.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry } from './RelationStrategy.ts'
import { rowToSection, type SectionRow } from './strategies.ts'

/**
 * Cypher for the entries. `match` binds p (Person), r (the edge), t (its
 * target); `returns` adds the entry's fields (targetSlug, targetName,
 * startDate, endDate, …). Undated entries sort last.
 */
export function edgeEntriesCypher(opts: { match: string; noteEdge: string; keyProp: string; returns: string }): string {
  return `
    MATCH ${opts.match}
    OPTIONAL MATCH (p)-[:${opts.noteEdge}]->(d:Description {${opts.keyProp}: r.id})
    OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
    WITH p, r, t, d, from
    OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
    WITH p, r, t, d, from,
         collect(CASE WHEN src IS NULL THEN NULL ELSE {
           inline:       coalesce(cites.inline, false),
           sourceId:     src.id,
           sourceTitle:  src.title,
           sourceUrl:    src.url,
           sourceAuthor: src.authorFreeText
         } END) AS rawCites
    WITH p, r, t,
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
    WITH p, r, t, collect(section) AS rawSections
    RETURN r.id AS edgeId, r.state AS state, coalesce(r.sourceRefs, []) AS sourceRefs, ${opts.returns},
           [x IN rawSections WHERE x IS NOT NULL] AS sections
    ORDER BY startDate, targetName
  `
}

export interface EdgeEntryRow {
  edgeId:     string | null
  state:      string | null
  targetSlug: string
  targetName: string
  startDate:  string | null
  endDate:    string | null
  sourceRefs: string[]
  sections:   SectionRow[]
}

export function edgeRowToEntry(r: EdgeEntryRow): RelationEntry {
  return {
    edgeId:         r.edgeId,
    state:          r.state,
    targetSlug:     r.targetSlug,
    targetName:     r.targetName,
    startDate:      r.startDate,
    endDate:        r.endDate,
    sourceRefs:     r.sourceRefs ?? [],
    sections:       (r.sections ?? []).map(rowToSection),
    hasDescription: (r.sections ?? []).length > 0,
  }
}

/** PATCH the entries, then copy the returned ids onto them (new rows get theirs here). */
export async function saveEdgeEntries(url: string, key: string, entries: RelationEntry[], items: Record<string, unknown>[]): Promise<void> {
  const res = await authFetch(url, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ [key]: items }),
  })
  const body = await res.json().catch(() => ({})) as { error?: string; ids?: string[] }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  entries.forEach((e, i) => { e.edgeId = body.ids?.[i] ?? e.edgeId })
}

export async function saveEdgeNote(url: string, sections: Section[]): Promise<void> {
  const payload = {
    sections: [...sections].sort((a, b) => a.order - b.order).map(s => ({
      order:         s.order,
      content:       s.content,
      citations:     s.citations.map(c => ({ inline: c.inline, sourceId: c.source.id })),
      sourcedFromId: s.sourcedFrom?.id ?? null,
    })),
  }
  const res = await authFetch(url, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status} on note`)
  }
}
