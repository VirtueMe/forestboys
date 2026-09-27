/**
 * useLocationData — Neo4j data layer for a Location detail page. Mirror
 * of useStationData.
 *
 * Locations are a leaf kind — slug, canonicalName, lat/lng, optional
 * description sections. The same composable backs the proposal preview
 * (via useProposalLocationData), which only reads `location` and
 * `savedSections`.
 *
 * Relations:
 *  - (e:Incident|Operation)-[:AT|FROM|TO]->(l) — Hendelser
 *  - (:Person)-[:STATIONED_AT]->(l)            — Personer
 *  - (l)-[:HAS_IMAGE]->(:Source)               — Galleri
 *  - (l)-[:REFERENCED_IN]->(:Source)           — Lenker
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import type { SlideImage } from '@/components/ImageSlider.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry } from '@/components/relation/RelationStrategy.ts'
import { LocationStaysStrategy } from '@/components/relation/stayStrategies.ts'

export interface LocationNode {
  slug:          string
  canonicalName: string
  lat:           number | null
  lng:           number | null
}

export interface LocationEvent {
  slug:  string
  title: string
  date:  string | null
  role:  'at' | 'from' | 'to'
}
export interface LocationExternalRef {
  id: string; title: string | null; url: string;
  type: string; domain: string | null; nbBacked: boolean
}

interface SectionRow {
  order:     number | null
  content:   string | null
  citations: Array<{
    inline:       boolean | null
    sourceId:     string | null
    sourceTitle:  string | null
    sourceUrl:    string | null
    sourceAuthor: string | null
  }>
  sourcedFrom: {
    id:             string
    title:          string | null
    url:            string | null
    authorFreeText: string | null
    license:        string | null
    attribution:    string | null
  } | null
}

function rowToSection(r: SectionRow): Section {
  return {
    order:   r.order ?? 1,
    content: r.content ?? '[]',
    citations: (r.citations ?? [])
      .filter(c => c.sourceId)
      .map(c => ({
        inline: c.inline ?? false,
        source: {
          id:             c.sourceId!,
          title:          c.sourceTitle,
          url:            c.sourceUrl,
          authorFreeText: c.sourceAuthor,
        },
      })),
    sourcedFrom: r.sourcedFrom ? { ...r.sourcedFrom } : null,
  }
}

export function useLocationData() {
  const location      = ref<LocationNode | null>(null)
  const savedSections = ref<Section[]>([])
  const events        = ref<LocationEvent[]>([])
  const externalRefs  = ref<LocationExternalRef[]>([])
  const galleryImages = ref<SlideImage[]>([])
  const people        = ref<RelationEntry[]>([])

  function resetLocation() {
    location.value      = null
    savedSections.value = []
    events.value        = []
    externalRefs.value  = []
    galleryImages.value = []
    people.value        = []
  }

  async function loadLocation(slug: string): Promise<void> {
    if (slug === 'new') {
      location.value = { slug: '', canonicalName: '', lat: null, lng: null }
      return
    }
    try {
      const [rows, sectionRows, eventRows, refRows, galleryRows, stayRows] = await Promise.all([
        neo4jQuery<LocationNode>(
          `MATCH (l:Location {slug: $slug})
           RETURN l.slug AS slug,
                  coalesce(l.canonicalName, l.title) AS canonicalName,
                  l.lat AS lat, l.lng AS lng`,
          { slug },
        ),
        neo4jQuery<SectionRow>(
          `MATCH (l:Location {slug: $slug})-[:HAS_CONTENT]->(d:Description)
           OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
           WITH d, from
           OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
           WITH d, from,
                collect(CASE WHEN src IS NULL THEN NULL ELSE {
                  inline:       coalesce(cites.inline, false),
                  sourceId:     src.id,
                  sourceTitle:  src.title,
                  sourceUrl:    src.url,
                  sourceAuthor: src.authorFreeText
                } END) AS rawCites
           RETURN coalesce(d.order, 1) AS \`order\`,
                  d.content AS content,
                  [x IN rawCites WHERE x IS NOT NULL] AS citations,
                  CASE WHEN from IS NULL THEN NULL ELSE {
                    id:             from.id,
                    title:          from.title,
                    url:            from.url,
                    authorFreeText: from.authorFreeText,
                    license:        from.license,
                    attribution:    from.attribution
                  } END AS sourcedFrom
           ORDER BY \`order\``,
          { slug },
        ),
        // Incidents sit AT a place; Operations run FROM → TO. Legacy
        // incident FROM/TO edges (pre migrate-incident-at) show too.
        neo4jQuery<LocationEvent>(
          `MATCH (e)-[r:AT|FROM|TO]->(:Location {slug: $slug})
           WHERE (e:Incident OR e:Operation) AND e.slug IS NOT NULL
           RETURN DISTINCT e.slug AS slug,
                  coalesce(e.title, e.codeName, e.canonicalName) AS title,
                  coalesce(e.date, e.startDate) AS date,
                  toLower(type(r)) AS role
           ORDER BY date`,
          { slug },
        ),
        neo4jQuery<LocationExternalRef>(
          `MATCH (l:Location {slug: $slug})-[:REFERENCED_IN]->(src:Source)
           RETURN src.id AS id, src.title AS title, src.url AS url,
                  src.type AS type, src.domain AS domain,
                  coalesce(src.nbBacked, false) AS nbBacked
           ORDER BY nbBacked DESC, src.type, coalesce(src.title, src.url)`,
          { slug },
        ),
        neo4jQuery<{ url: string; caption: string | null; subjectName: string; subjectSlug: string }>(
          `MATCH (l:Location {slug: $slug})-[h:HAS_IMAGE]->(src:Source)
           RETURN src.url AS url, h.caption AS caption,
                  coalesce(l.canonicalName, l.title) AS subjectName,
                  l.slug AS subjectSlug
           ORDER BY coalesce(h.order, 0)
           LIMIT 200`,
          { slug },
        ),
        LocationStaysStrategy.fetchEntries(slug),
      ])

      location.value      = rows[0] ?? null
      savedSections.value = sectionRows.map(rowToSection)
      events.value        = eventRows
      people.value        = stayRows
      externalRefs.value  = refRows

      const seen = new Set<string>()
      galleryImages.value = galleryRows
        .filter(r => !seen.has(r.url) && seen.add(r.url))
        .map(r => ({
          url:         r.url,
          caption:     r.caption,
          subjectName: r.subjectName,
          subjectSlug: r.subjectSlug,
          subjectType: 'location' as const,
        }))
    } catch (err) {
      console.error('[useLocationData] load failed:', err)
      location.value = null
    }
  }

  return {
    location,
    savedSections,
    events,
    externalRefs,
    galleryImages,
    people,
    loadLocation,
    resetLocation,
  }
}
