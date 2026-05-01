/**
 * useLocationData — Neo4j data layer for a single Location.
 *
 * Locations are a leaf kind — slug, canonicalName, lat/lng, optional
 * description sections. The proposal preview uses this to render a
 * focused view; no live detail page is wired yet (Locations show up
 * primarily on the map, not as standalone detail pages).
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import type { Section } from '@/components/SectionsEditor.vue'

export interface LocationNode {
  slug:          string
  canonicalName: string
  lat:           number | null
  lng:           number | null
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

export function useLocationData() {
  const location      = ref<LocationNode | null>(null)
  const savedSections = ref<Section[]>([])

  function resetLocation() {
    location.value      = null
    savedSections.value = []
  }

  async function loadLocation(slug: string): Promise<void> {
    if (slug === 'new') {
      location.value = { slug: '', canonicalName: '', lat: null, lng: null }
      return
    }
    const [rows, descRows] = await Promise.all([
      neo4jQuery<LocationNode>(
        `MATCH (l:Location {slug: $slug})
         RETURN l.slug AS slug,
                coalesce(l.canonicalName, l.title) AS canonicalName,
                l.lat AS lat, l.lng AS lng`,
        { slug },
      ),
      neo4jQuery<SectionRow>(
        `MATCH (:Location {slug: $slug})-[:HAS_CONTENT]->(d:Description)
         RETURN d.order AS order, d.content AS content
         ORDER BY coalesce(d.order, 1) ASC`,
        { slug },
      ),
    ])
    location.value      = rows[0] ?? null
    savedSections.value = descRows.map(rowToSection)
  }

  return {
    location,
    savedSections,
    loadLocation,
    resetLocation,
  }
}
