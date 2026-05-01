/**
 * useOutlineData — Neo4j data layer for an Outline detail page.
 *
 * Same shape as usePersonData / useUnitData / etc.: returns reactive
 * refs the page binds to, plus `loadOutline(slug)` and `resetOutline()`
 * the page calls from its DetailPage / inject-driven render.
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import type { Section } from '@/components/SectionsEditor.vue'

export interface OutlineNode {
  slug:          string
  canonicalName: string
  sanityRev:     string | null
}

export interface OutlineMention {
  slug: string
  name: string
}

interface SectionRow { order: number | null; content: string | null }

function rowToSection(r: SectionRow): Section {
  return {
    order:       r.order ?? 1,
    content:     r.content ?? '[]',
    citations:   [],
    sourcedFrom: null,
  }
}

export function useOutlineData() {
  const outline       = ref<OutlineNode | null>(null)
  const savedSections = ref<Section[]>([])
  const mentions      = ref<OutlineMention[]>([])

  function resetOutline() {
    outline.value       = null
    savedSections.value = []
    mentions.value      = []
  }

  async function loadOutline(slug: string): Promise<void> {
    if (slug === 'new') {
      outline.value = { slug: '', canonicalName: '', sanityRev: null }
      return
    }
    const [outlineRows, descRows, mentionRows] = await Promise.all([
      neo4jQuery<OutlineNode>(
        `MATCH (o:Outline {slug: $slug})
         RETURN o.slug AS slug,
                coalesce(o.canonicalName, o.title) AS canonicalName,
                o.sanityRev AS sanityRev`,
        { slug },
      ),
      neo4jQuery<SectionRow>(
        `MATCH (:Outline {slug: $slug})-[:HAS_CONTENT]->(d:Description)
         RETURN d.order AS order, d.content AS content
         ORDER BY coalesce(d.order, 1) ASC`,
        { slug },
      ),
      neo4jQuery<OutlineMention>(
        `MATCH (:Outline {slug: $slug})-[:MENTIONS]->(p:Person)
         RETURN p.slug AS slug, p.canonicalName AS name
         ORDER BY name`,
        { slug },
      ),
    ])
    outline.value       = outlineRows[0] ?? null
    savedSections.value = descRows.map(rowToSection)
    mentions.value      = mentionRows
  }

  return {
    outline,
    savedSections,
    mentions,
    loadOutline,
    resetOutline,
  }
}
