/**
 * useTransportData — Neo4j data layer for a Transport (vehicle/aircraft)
 * detail page. Mirror of useStationData / useUnitData.
 *
 * Legacy properties carried in from the Sanity import — `description`
 * (free text), `links` (JSON string), `rawUnit`, `regser`, `reserve` —
 * stay on the node and are surfaced by the ViewPane until structured
 * editors take them over. New editor writes target HAS_CONTENT only.
 *
 * Relations:
 *  - (:Person)-[:CREW_OF {role}]->(t)  — Mannskap, role from controlled vocab
 *  - (e:Operation|Incident)-[:USED]->(t) — Hendelser
 *  - (t)-[:HAS_IMAGE]->(:Source)       — Galleri
 *  - (t)-[:REFERENCED_IN]->(:Source)   — Lenker
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import type { SlideImage } from '@/components/ImageSlider.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import { tidyText } from '@/utils/tidyText'

export interface TransportNode {
  name:        string
  type:        string | null
  unit:        string | null
  regser:      string | null
  reserve:     string | null
  /** Legacy free-text description from Sanity migration. */
  description: string | null
  /** Legacy JSON-string of [{title, link}] from Sanity migration. */
  links:       string | null
}

export interface TransportCrewMember {
  slug: string
  name: string
  role: string | null
}
export interface TransportEvent { slug: string; title: string; date: string | null }
export interface TransportExternalRef {
  id: string; title: string | null; url: string;
  type: string; domain: string | null; nbBacked: boolean
}

interface SectionRow {
  order:        number | null
  content:      string | null
  citations: Array<{
    inline:        boolean | null
    sourceId:      string | null
    sourceTitle:   string | null
    sourceUrl:     string | null
    sourceAuthor:  string | null
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

export function useTransportData() {
  const transport     = ref<TransportNode | null>(null)
  const savedSections = ref<Section[]>([])
  const crew          = ref<TransportCrewMember[]>([])
  const events        = ref<TransportEvent[]>([])
  const externalRefs  = ref<TransportExternalRef[]>([])
  const galleryImages = ref<SlideImage[]>([])

  function resetTransport() {
    transport.value     = null
    savedSections.value = []
    crew.value          = []
    events.value        = []
    externalRefs.value  = []
    galleryImages.value = []
  }

  async function loadTransport(slug: string) {
    if (slug === 'new') {
      transport.value = {
        name: '', type: null, unit: null, regser: null, reserve: null,
        description: null, links: null,
      }
      return
    }
    try {
      const [transportRows, sectionRows, crewRows, eventRows, refRows, galleryRows] = await Promise.all([
        // canonicalName from new model; fall back to legacy `name` on
        // pre-migration nodes so the page renders something while the
        // Sanity → Neo4j slug/canonicalName backfill is still pending.
        neo4jQuery<TransportNode>(
          `MATCH (t:Transport {slug: $slug})
           RETURN coalesce(t.canonicalName, t.name) AS name,
                  t.type        AS type,
                  coalesce(t.rawUnit, t.unit) AS unit,
                  t.regser      AS regser,
                  t.reserve     AS reserve,
                  t.description AS description,
                  t.links       AS links`,
          { slug },
        ),
        neo4jQuery<SectionRow>(
          `MATCH (t:Transport {slug: $slug})-[:HAS_CONTENT]->(d:Description)
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
                    url:             from.url,
                    authorFreeText: from.authorFreeText,
                    license:        from.license,
                    attribution:    from.attribution
                  } END AS sourcedFrom
           ORDER BY \`order\``,
          { slug },
        ),
        // Crew — pilots, dispatchers, etc; role comes from the
        // controlled-vocab list per the project memory.
        neo4jQuery<TransportCrewMember>(
          `MATCH (p:Person)-[r:CREW_OF]->(:Transport {slug: $slug})
           WHERE p.slug IS NOT NULL
           RETURN p.slug AS slug, p.canonicalName AS name, r.role AS role
           ORDER BY r.role, name`,
          { slug },
        ),
        neo4jQuery<TransportEvent>(
          `MATCH (e:Operation|Incident)-[:USED]->(:Transport {slug: $slug})
           WHERE e.slug IS NOT NULL
           RETURN DISTINCT e.slug AS slug,
                  coalesce(e.title, e.codeName, e.canonicalName) AS title,
                  e.date AS date
           ORDER BY date`,
          { slug },
        ),
        neo4jQuery<TransportExternalRef>(
          `MATCH (t:Transport {slug: $slug})-[:REFERENCED_IN]->(src:Source)
           RETURN src.id AS id, src.title AS title, src.url AS url,
                  src.type AS type, src.domain AS domain,
                  coalesce(src.nbBacked, false) AS nbBacked
           ORDER BY nbBacked DESC, src.type, coalesce(src.title, src.url)`,
          { slug },
        ),
        neo4jQuery<{ url: string; caption: string | null; subjectName: string; subjectSlug: string }>(
          `MATCH (t:Transport {slug: $slug})-[h:HAS_IMAGE]->(src:Source)
           RETURN src.url AS url, h.caption AS caption,
                  coalesce(t.canonicalName, t.name) AS subjectName,
                  t.slug AS subjectSlug
           ORDER BY subjectName
           LIMIT 200`,
          { slug },
        ),
      ])

      const row = transportRows[0]
      transport.value    = row
        ? { ...row,
            name:   tidyText(row.name) ?? '',
            type:   tidyText(row.type),
            unit:   tidyText(row.unit),
            regser: tidyText(row.regser) }
        : null
      crew.value         = crewRows
      events.value       = eventRows
      externalRefs.value = refRows

      const seen = new Set<string>()
      galleryImages.value = galleryRows
        .filter(r => !seen.has(r.url) && seen.add(r.url))
        .map(r => ({
          url:         r.url,
          caption:     r.caption,
          subjectName: r.subjectName,
          subjectSlug: r.subjectSlug,
          subjectType: 'transport' as SlideImage['subjectType'],
        }))

      savedSections.value = sectionRows.map(rowToSection)
    } catch (err) {
      console.error('[useTransportData] load failed:', err)
      transport.value = null
    }
  }

  return {
    transport,
    savedSections,
    crew,
    events,
    externalRefs,
    galleryImages,
    loadTransport,
    resetTransport,
  }
}
