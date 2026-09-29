/**
 * Rank history — `(:Person)-[:HELD_RANK {id, from, to, acting}]->(:Rank)`
 * (docs/PERSON-RANKS.md R2–R3). One entry per edge, keyed by id, with a
 * note per entry (`/api/admin/rank-note/:entryId`) saying why the rank was
 * awarded or the acting circumstances.
 *
 * The known rank (`RANK`) is not a relation list — see PersonRanksEditor.
 */

import { neo4jQuery } from '@/composables/useNeo4j.ts'
import type { RelationEntry, RelationStrategy, RelationTarget } from './RelationStrategy.ts'
import { edgeEntriesCypher, edgeRowToEntry, saveEdgeEntries, saveEdgeNote, type EdgeEntryRow } from './edgeEntries.ts'
import { comparePartial } from '@/utils/period.ts'

interface RankRow extends EdgeEntryRow { acting: boolean | null; tier: number | null }

export const RankHistoryStrategy: RelationStrategy = {
  async fetchTargets() {
    return neo4jQuery<RelationTarget>(`
      MATCH (r:Rank)
      RETURN r.slug AS slug, r.canonicalName AS name
      ORDER BY r.tier, r.canonicalName
    `)
  },
  async fetchEntries(personSlug) {
    const rows = await neo4jQuery<RankRow>(
      edgeEntriesCypher({
        match:    '(p:Person {slug: $slug})-[r:HELD_RANK]->(t:Rank)',
        noteEdge: 'HAS_RANK_NOTE',
        keyProp:  'rankEntryId',
        returns:  `t.slug AS targetSlug, t.canonicalName AS targetName, t.tier AS tier,
                   r.from AS startDate, r.to AS endDate, coalesce(r.acting, false) AS acting`,
      }),
      { slug: personSlug },
    )
    return rows.map(r => ({ ...edgeRowToEntry(r), acting: r.acting === true }))
  },
  saveEntries(personSlug, entries) {
    return saveEdgeEntries(
      `/api/admin/person/${encodeURIComponent(personSlug)}/ranks`, 'ranks',
      entries,
      entries.map(e => ({
        id: e.edgeId ?? null, rankSlug: e.targetSlug,
        from: e.startDate, to: e.endDate, acting: e.acting === true,
      })),
    )
  },
  saveNote: (_personSlug, entryId, sections) =>
    saveEdgeNote(`/api/admin/rank-note/${encodeURIComponent(entryId)}`, sections),
  targetRoute() { return '/admin/ranks' },
}

/**
 * The open entry of one kind with the latest `from` — "where the history
 * ends" for real ranks, or the acting rank currently held.
 */
export function latestOpen(entries: RelationEntry[], acting: boolean): RelationEntry | null {
  const open = entries.filter(e => !!e.acting === acting && !e.endDate && e.targetSlug)
  if (!open.length) return null
  return open.reduce((a, b) => (b.startDate && (!a.startDate || comparePartial(b.startDate, a.startDate) > 0) ? b : a))
}

export const actingLabel = (e: RelationEntry) => (e.acting ? 'fungerende' : '')
