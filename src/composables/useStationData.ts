/**
 * useStationData — Neo4j data layer for a Station detail page. Mirror
 * of useUnitData / useOrganizationData / usePersonData.
 *
 * Station core fields come from Neo4j (no more Sanity → IndexedDB read
 * path). Existing legacy properties on the node — `description` (free
 * text), `links` (JSON string), `activeFrom`, `activeTo` — stay visible
 * in the ViewPane until they're migrated to the structured model
 * (HAS_CONTENT / REFERENCED_IN). New editor writes target the
 * HAS_CONTENT description model only.
 *
 * Relations:
 *  - (:Person)-[:STATIONED_AT]->(s)  — Deltakere
 *  - (e:Event)-[:DEPARTED_FROM_STATION|ARRIVED_AT_STATION]->(s) — Hendelser
 *  - (s)-[:HAS_IMAGE]->(:Source)     — Galleri
 *  - (s)-[:REFERENCED_IN]->(:Source) — Lenker
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import type { SlideImage } from '@/components/ImageSlider.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry } from '@/components/relation/RelationStrategy.ts'
import { StationStaysStrategy } from '@/components/relation/stayStrategies.ts'

export interface StationNode {
  name:        string
  type:        string | null
  lat:         number | null
  lng:         number | null
  activeFrom:  string | null
  activeTo:    string | null
  /** Legacy free-text description from Sanity migration. Read-only. */
  description: string | null
  /** Legacy JSON-string of [{title, link}] from Sanity migration. */
  links:       string | null
}

export type StationNameType = 'former' | 'later' | 'alias'

/** One other name of the Station — (:Station)-[:HAS_NAME]->(:Name), docs/SCHEMA.md. */
export interface StationName {
  id:         string
  value:      string
  type:       StationNameType
  from:       string | null
  fromAbout:  boolean
  to:         string | null
  toAbout:    boolean
  sourceRefs: string[]
}

export interface StationEvent { slug: string; title: string; date: string | null; direction: 'departed' | 'arrived' }
export interface StationExternalRef {
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

export function useStationData() {
  const station       = ref<StationNode | null>(null)
  const savedSections = ref<Section[]>([])
  const names         = ref<StationName[]>([])
  const people        = ref<RelationEntry[]>([])
  const events        = ref<StationEvent[]>([])
  const externalRefs  = ref<StationExternalRef[]>([])
  const galleryImages = ref<SlideImage[]>([])

  function resetStation() {
    station.value       = null
    savedSections.value = []
    names.value         = []
    people.value        = []
    events.value        = []
    externalRefs.value  = []
    galleryImages.value = []
  }

  async function loadStation(slug: string) {
    if (slug === 'new') {
      station.value = {
        name: '', type: null, lat: null, lng: null,
        activeFrom: null, activeTo: null,
        description: null, links: null,
      }
      return
    }
    try {
      const [stationRows, sectionRows, nameRows, peopleRows, eventRows, refRows, galleryRows] = await Promise.all([
        // canonicalName from new model; fall back to legacy `title` on
        // pre-migration nodes so the page renders something while the
        // Sanity → Neo4j slug/canonicalName backfill is still pending.
        neo4jQuery<StationNode>(
          `MATCH (s:Station {slug: $slug})
           RETURN coalesce(s.canonicalName, s.title) AS name,
                  s.type        AS type,
                  s.lat         AS lat,
                  s.lng         AS lng,
                  s.activeFrom  AS activeFrom,
                  s.activeTo    AS activeTo,
                  s.description AS description,
                  s.links       AS links`,
          { slug },
        ),
        neo4jQuery<SectionRow>(
          `MATCH (s:Station {slug: $slug})-[:HAS_CONTENT]->(d:Description)
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
        neo4jQuery<{
          id: string; order: number | null; value: string; type: StationNameType
          from: string | null; fromAbout: boolean | null; to: string | null; toAbout: boolean | null
          sourceRefs: string[] | null
        }>(
          `MATCH (:Station {slug: $slug})-[:HAS_NAME]->(n:Name)
           RETURN n.id AS id, n.order AS \`order\`, n.value AS value, n.type AS type,
                  n.from AS \`from\`, n.fromAbout AS fromAbout, n.to AS \`to\`, n.toAbout AS toAbout,
                  n.sourceRefs AS sourceRefs
           ORDER BY coalesce(n.order, 0), n.value`,
          { slug },
        ),
        StationStaysStrategy.fetchEntries(slug),
        // Direction marks departures vs arrivals; both surface in the
        // same Hendelser list, separately labelled.
        neo4jQuery<StationEvent>(
          `MATCH (e:Event)-[r:DEPARTED_FROM_STATION|ARRIVED_AT_STATION]->(:Station {slug: $slug})
           WHERE e.slug IS NOT NULL
           RETURN DISTINCT e.slug AS slug,
                  coalesce(e.title, e.canonicalName) AS title,
                  e.date AS date,
                  CASE type(r) WHEN 'DEPARTED_FROM_STATION' THEN 'departed' ELSE 'arrived' END AS direction
           ORDER BY date`,
          { slug },
        ),
        neo4jQuery<StationExternalRef>(
          `MATCH (s:Station {slug: $slug})-[:REFERENCED_IN]->(src:Source)
           RETURN src.id AS id, src.title AS title, src.url AS url,
                  src.type AS type, src.domain AS domain,
                  coalesce(src.nbBacked, false) AS nbBacked
           ORDER BY nbBacked DESC, src.type, coalesce(src.title, src.url)`,
          { slug },
        ),
        // Gallery — direct station images. No graph propagation yet
        // (events here can be added when DEPARTED/ARRIVED events grow
        // their own image attachments).
        neo4jQuery<{ url: string; caption: string | null; subjectName: string; subjectSlug: string; sortKey: number }>(
          `MATCH (s:Station {slug: $slug})-[h:HAS_IMAGE]->(src:Source)
           RETURN src.url AS url, h.caption AS caption,
                  coalesce(s.canonicalName, s.title) AS subjectName,
                  s.slug AS subjectSlug,
                  0 AS sortKey
           ORDER BY sortKey, subjectName
           LIMIT 200`,
          { slug },
        ),
      ])

      station.value      = stationRows[0] ?? null
      names.value        = nameRows.map(n => ({
        id:         n.id,
        value:      n.value,
        type:       n.type,
        from:       n.from,
        fromAbout:  n.fromAbout ?? false,
        to:         n.to,
        toAbout:    n.toAbout ?? false,
        sourceRefs: n.sourceRefs ?? [],
      }))
      people.value       = peopleRows
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
          subjectType: 'station' as SlideImage['subjectType'],
        }))

      savedSections.value = sectionRows.map(rowToSection)
    } catch (err) {
      console.error('[useStationData] load failed:', err)
      station.value = null
    }
  }

  return {
    station,
    savedSections,
    names,
    people,
    events,
    externalRefs,
    galleryImages,
    loadStation,
    resetStation,
  }
}
