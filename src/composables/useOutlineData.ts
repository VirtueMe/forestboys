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
import type { SlideImage } from '@/components/ImageSlider.vue'
import type { ExternalRef } from '@/components/person/PersonExternalRefs.vue'

export interface OutlineNode {
  slug:          string
  canonicalName: string
  sanityRev:     string | null
}

export interface OutlineMention {
  slug: string
  name: string
}

/** A link of the outline: a Source it is REFERENCED_IN (Sanity's `links`, brought in by the link sync). */
export type OutlineExternalRef = ExternalRef

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
  const externalRefs  = ref<OutlineExternalRef[]>([])
  const galleryImages = ref<SlideImage[]>([])

  function resetOutline() {
    outline.value       = null
    savedSections.value = []
    mentions.value      = []
    externalRefs.value  = []
    galleryImages.value = []
  }

  async function loadOutline(slug: string): Promise<void> {
    if (slug === 'new') {
      outline.value = { slug: '', canonicalName: '', sanityRev: null }
      return
    }
    const [outlineRows, descRows, mentionRows, refRows, imageRows] = await Promise.all([
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
      // Links and gallery, as the station page reads them: what Sanity's `links` and `gallery` became (#301, #321).
      neo4jQuery<OutlineExternalRef>(
        `MATCH (:Outline {slug: $slug})-[:REFERENCED_IN]->(src:Source)
         RETURN src.id AS id, src.title AS title, src.url AS url,
                src.type AS type, src.domain AS domain,
                coalesce(src.nbBacked, false) AS nbBacked
         ORDER BY nbBacked DESC, src.type, coalesce(src.title, src.url)`,
        { slug },
      ),
      neo4jQuery<{ url: string; caption: string | null }>(
        `MATCH (:Outline {slug: $slug})-[h:HAS_IMAGE]->(src:Source)
         RETURN src.url AS url, h.caption AS caption
         ORDER BY coalesce(h.order, 9999), src.url
         LIMIT 200`,
        { slug },
      ),
    ])
    outline.value       = outlineRows[0] ?? null
    savedSections.value = descRows.map(rowToSection)
    mentions.value      = mentionRows
    externalRefs.value  = refRows

    const seen = new Set<string>()
    galleryImages.value = imageRows
      .filter(r => !!r.url && !seen.has(r.url) && seen.add(r.url))
      .map(r => ({ url: r.url, caption: r.caption }))
  }

  return {
    outline,
    savedSections,
    mentions,
    externalRefs,
    galleryImages,
    loadOutline,
    resetOutline,
  }
}
