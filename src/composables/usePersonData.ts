/**
 * usePersonData — owns the Neo4j data layer for a Person detail page.
 *
 * Returns the reactive refs every section consumes (core identity, hero,
 * gallery, external refs, ranks + options, description sections, all four
 * relation pairs) plus `loadPerson(slug)` and `resetPerson()` for the
 * page's DetailPage callbacks.
 *
 * The composable does NOT watch the route — `DetailPage` already invokes
 * the load/reset hooks on slug change. The page passes them through:
 *
 *   const data = usePersonData()
 *   <DetailPage :load="data.loadPerson" :reset="data.resetPerson" …>
 */
import { ref, computed } from 'vue'
import { useLocationCache } from './useLocationCache.ts'
import { neo4jQuery } from './useNeo4j.ts'
import type { SlideImage } from '@/components/ImageSlider.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import {
  MembershipStrategy, AttendanceStrategy,
  IncidentStrategy, OperationStrategy,
} from '@/components/relation/strategies.ts'
import type { HeldRank, RankOption, PersonType } from '@/components/person/types.ts'

export interface Neo4jPerson {
  slug: string
  name: string
  secretName: string | null
  home: string | null
  birthYear: number | null
  status: string | null
  serviceClass: string | null
  type: PersonType
}

export interface ExternalRef {
  id:       string
  title:    string | null
  url:      string
  type:     string
  domain:   string | null
  nbBacked: boolean
}

interface SectionRow {
  order:        number | null
  content:      string | null
  citations:    {
    inline:        boolean | null
    sourceId:      string | null
    sourceTitle:   string | null
    sourceUrl:     string | null
    sourceAuthor:  string | null
  }[]
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

export function usePersonData() {
  const { init } = useLocationCache()

  const neo4jPerson   = ref<Neo4jPerson | null>(null)
  const heroImage     = ref<{ url: string; caption: string | null } | null>(null)
  const galleryImages = ref<SlideImage[]>([])
  const externalRefs  = ref<ExternalRef[]>([])
  const heldRanks     = ref<HeldRank[]>([])
  const allRanks      = ref<RankOption[]>([])
  const savedSections = ref<Section[]>([])

  const membershipEntries  = ref<RelationEntry[]>([])
  const membershipTargets  = ref<RelationTarget[]>([])
  const attendanceEntries  = ref<RelationEntry[]>([])
  const attendanceTargets  = ref<RelationTarget[]>([])
  const incidentEntries    = ref<RelationEntry[]>([])
  const incidentTargets    = ref<RelationTarget[]>([])
  const operationEntries   = ref<RelationEntry[]>([])
  const operationTargets   = ref<RelationTarget[]>([])

  /** Bundle the four entries/targets pairs so PersonRelations gets one prop. */
  const relationsData = computed(() => ({
    membership: { entries: membershipEntries.value, targets: membershipTargets.value },
    attendance: { entries: attendanceEntries.value, targets: attendanceTargets.value },
    operation:  { entries: operationEntries.value,  targets: operationTargets.value  },
    incident:   { entries: incidentEntries.value,   targets: incidentTargets.value   },
  }))

  function resetPerson() {
    neo4jPerson.value   = null
    heroImage.value     = null
    galleryImages.value = []
    externalRefs.value  = []
    heldRanks.value     = []
    allRanks.value      = []
    savedSections.value = []
    membershipEntries.value = []
    membershipTargets.value = []
    attendanceEntries.value = []
    attendanceTargets.value = []
    incidentEntries.value   = []
    incidentTargets.value   = []
    operationEntries.value  = []
    operationTargets.value  = []
  }

  async function loadPerson(slug: string) {
    // IDB cache gives us optional rich extras (description, locations, stations,
    // movie, outlines) when a person was in the Sanity dump. Neo4j is the
    // source of existence — a person found in Neo4j but missing from IDB just
    // renders with fewer sections.
    await init()

    try {
      const [
        personRows, heroRows, galleryRows, refRows,
        memberEntries, memberTargets, attendEntries, attendTargets,
        incidEntries, incidTargets, operEntries, operTargets,
        rankRows, allRankRows, sectionRows,
      ] = await Promise.all([
        neo4jQuery<Neo4jPerson>(
          `MATCH (p:Person {slug: $slug})
           RETURN p.slug AS slug, p.canonicalName AS name,
                  p.secretName AS secretName, p.home AS home,
                  p.birthYear AS birthYear, p.status AS status,
                  p.serviceClass AS serviceClass,
                  coalesce(p.type, 'civilian') AS type`,
          { slug },
        ),
        // Hero priority: 1) HAS_IMAGE.isHero=true, 2) Source.kind='portrait',
        // 3) first direct image by edge order (Sanity convention).
        neo4jQuery<{ url: string; caption: string | null }>(
          `MATCH (p:Person {slug: $slug})-[h:HAS_IMAGE]->(s:Source)
           WITH s, h,
                CASE WHEN h.isHero = true      THEN 0
                     WHEN s.kind    = 'portrait' THEN 1
                                                 ELSE 2 END AS tier
           RETURN s.url AS url, h.caption AS caption
           ORDER BY tier, h.order
           LIMIT 1`,
          { slug },
        ),
        // Gallery buckets: 0 own, 1 operations, 2 incidents, 3 unit, 4 orgs.
        neo4jQuery<{ url: string; caption: string | null; subjectName: string; subjectSlug: string; subjectType: string; sortKey: number }>(
          `MATCH (person:Person {slug: $slug})
           CALL {
             WITH person
             MATCH (person)-[h:HAS_IMAGE]->(s:Source)
             RETURN s.url AS url, h.caption AS caption,
                    person.canonicalName AS subjectName, person.slug AS subjectSlug,
                    'person' AS subjectType, 0 AS sortKey
             UNION
             WITH person
             MATCH (person)-[:INVOLVED_IN]->(:Incident)-[:PART_OF]->(op:Operation)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
             RETURN s.url AS url, h.caption AS caption,
                    op.codeName AS subjectName, op.slug AS subjectSlug,
                    'operation' AS subjectType, 1 AS sortKey
             UNION
             WITH person
             MATCH (person)-[:INVOLVED_IN]->(i:Incident)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
             RETURN s.url AS url, h.caption AS caption,
                    i.title AS subjectName, i.slug AS subjectSlug,
                    'incident' AS subjectType, 2 AS sortKey
             UNION
             WITH person
             MATCH (person)-[:MEMBER_OF]->(u:Unit)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
             RETURN s.url AS url, h.caption AS caption,
                    u.canonicalName AS subjectName, u.slug AS subjectSlug,
                    'unit' AS subjectType, 3 AS sortKey
             UNION
             WITH person
             MATCH (person)-[:MEMBER_OF]-(x)-[:PART_OF*0..]->(o:Organization)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
             RETURN s.url AS url, h.caption AS caption,
                    o.canonicalName AS subjectName, o.slug AS subjectSlug,
                    'organization' AS subjectType, 4 AS sortKey
           }
           RETURN url, caption, subjectName, subjectSlug, subjectType, sortKey
           ORDER BY sortKey, subjectName
           LIMIT 200`,
          { slug },
        ),
        // External references — Sources this Person is REFERENCED_IN.
        // NB-backed sources sort first, then by type, then by title.
        neo4jQuery<ExternalRef>(
          `MATCH (p:Person {slug: $slug})-[:REFERENCED_IN]->(s:Source)
           RETURN s.id AS id, s.title AS title, s.url AS url,
                  s.type AS type, s.domain AS domain,
                  coalesce(s.nbBacked, false) AS nbBacked
           ORDER BY nbBacked DESC, s.type, coalesce(s.title, s.url)`,
          { slug },
        ),
        MembershipStrategy.fetchEntries(slug),
        MembershipStrategy.fetchTargets(),
        AttendanceStrategy.fetchEntries(slug),
        AttendanceStrategy.fetchTargets(),
        IncidentStrategy.fetchEntries(slug),
        IncidentStrategy.fetchTargets(),
        OperationStrategy.fetchEntries(slug),
        OperationStrategy.fetchTargets(),
        neo4jQuery<HeldRank>(
          `MATCH (p:Person {slug: $slug})-[h:HELD_RANK]->(r:Rank)
           RETURN r.slug AS rankSlug, r.canonicalName AS rankName, r.tier AS tier,
                  h.from AS from, h.to AS to
           ORDER BY coalesce(h.from, 0), r.tier`,
          { slug },
        ),
        neo4jQuery<RankOption>(
          `MATCH (r:Rank)
           RETURN r.slug AS slug, r.canonicalName AS name, r.tier AS tier
           ORDER BY r.tier, r.canonicalName`,
        ),
        neo4jQuery<SectionRow>(
          `MATCH (p:Person {slug: $slug})-[:HAS_CONTENT]->(d:Description)
           OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
           WITH d, from
             ORDER BY coalesce(d.order, 1)
           OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
           WITH d, from, collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
           RETURN coalesce(d.order, 1) AS order, d.content AS content,
                  [x IN rawCites WHERE x IS NOT NULL] AS citations,
                  CASE WHEN from IS NULL THEN NULL ELSE {
                    id:             from.id,
                    title:          from.title,
                    url:             from.url,
                    authorFreeText: from.authorFreeText,
                    license:        from.license,
                    attribution:    from.attribution
                  } END AS sourcedFrom
           ORDER BY order`,
          { slug },
        ),
      ])
      heroImage.value = heroRows[0] ?? null
      const seen = new Set<string>()
      galleryImages.value = galleryRows
        .filter(r => !seen.has(r.url) && seen.add(r.url))
        .map(r => ({
          url:         r.url,
          caption:     r.caption,
          subjectName: r.subjectName,
          subjectSlug: r.subjectSlug,
          subjectType: r.subjectType as SlideImage['subjectType'],
        }))
      externalRefs.value      = refRows
      membershipEntries.value = memberEntries
      membershipTargets.value = memberTargets
      attendanceEntries.value = attendEntries
      attendanceTargets.value = attendTargets
      incidentEntries.value   = incidEntries
      incidentTargets.value   = incidTargets
      operationEntries.value  = operEntries
      operationTargets.value  = operTargets
      heldRanks.value     = rankRows
      allRanks.value      = allRankRows
      savedSections.value = sectionRows.map(rowToSection)
      neo4jPerson.value   = personRows[0] ?? null
    } catch (err) {
      console.error('[usePersonData] load failed:', err)
    }
  }

  return {
    // Refs
    neo4jPerson,
    heroImage,
    galleryImages,
    externalRefs,
    heldRanks,
    allRanks,
    savedSections,
    membershipEntries, membershipTargets,
    attendanceEntries, attendanceTargets,
    incidentEntries,   incidentTargets,
    operationEntries,  operationTargets,
    // Derived
    relationsData,
    // Lifecycle
    loadPerson,
    resetPerson,
  }
}
