/**
 * useSourceData — Neo4j data layer for one Source. A Source has no page of
 * its own (/admin/sources lists them): this backs SourcePreviewBody, which
 * the review preview renders (via useProposalSourceData).
 *
 * Keyed by `id`, not `slug`. Description: sections via HAS_CONTENT.
 * Referrers: (x)-[:REFERENCED_IN]->(source).
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import type { Section } from '@/components/SectionsEditor.vue'

export interface SourceNode {
  id:             string
  title:          string | null
  type:           string | null
  url:            string | null
  authorFreeText: string | null
  publishedDate:  string | null
}

export interface SourceReferrer { kind: string; key: string; name: string }

export function useSourceData() {
  const source        = ref<SourceNode | null>(null)
  const savedSections = ref<Section[]>([])
  const referrers     = ref<SourceReferrer[]>([])

  function resetSource() {
    source.value        = null
    savedSections.value = []
    referrers.value     = []
  }

  async function loadSource(id: string): Promise<void> {
    try {
      const [rows, sectionRows, referrerRows] = await Promise.all([
        neo4jQuery<SourceNode>(
          `MATCH (s:Source {id: $id})
           RETURN s.id AS id, s.title AS title, s.type AS type, s.url AS url,
                  s.authorFreeText AS authorFreeText, s.publishedDate AS publishedDate`,
          { id },
        ),
        neo4jQuery<{ order: number | null; content: string | null }>(
          `MATCH (:Source {id: $id})-[:HAS_CONTENT]->(d:Description)
           RETURN coalesce(d.order, 1) AS \`order\`, d.content AS content
           ORDER BY \`order\``,
          { id },
        ),
        neo4jQuery<SourceReferrer>(
          `MATCH (x)-[:REFERENCED_IN]->(:Source {id: $id})
           RETURN labels(x)[0] AS kind, coalesce(x.slug, x.id) AS key,
                  coalesce(x.canonicalName, x.title, x.codeName, x.slug) AS name
           ORDER BY kind, name
           LIMIT 50`,
          { id },
        ),
      ])
      source.value        = rows[0] ?? null
      savedSections.value = sectionRows.map(r => ({
        order: r.order ?? 1, content: r.content ?? '[]', citations: [], sourcedFrom: null,
      }))
      referrers.value     = referrerRows
    } catch (err) {
      console.error('[useSourceData] load failed:', err)
      source.value = null
    }
  }

  return { source, savedSections, referrers, loadSource, resetSource }
}
