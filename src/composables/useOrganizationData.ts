/**
 * useOrganizationData — owns the Neo4j data layer for an Organization
 * detail page. Mirrors the shape of usePersonData.
 *
 * Returns the reactive refs every section consumes (org core fields,
 * description sections, sub-unit relations + targets, orchestrated
 * operations + incidents, participants reached via incidents, gallery,
 * external refs) plus `loadOrg(slug)` and `resetOrg()` for the page's
 * DetailPage callbacks.
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import type { SlideImage } from '@/components/ImageSlider.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import { OrganizationUnitsStrategy, OrgOperationsStrategy, OrgIncidentsStrategy } from '@/components/relation/strategies.ts'
import type { ExternalRef } from '@/components/person/PersonExternalRefs.vue'

export interface OrgNode {
  name:          string
  formalName:    string | null
  abbreviation:  string | null
  sortingName:   string | null
  color:         string | null
  foundedDate:   string | null
  dissolvedDate: string | null
  country:       string | null
}

export interface DeltakerLink { slug: string; name: string; eventCount: number }

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

export function useOrganizationData() {
  const org           = ref<OrgNode | null>(null)
  const savedSections = ref<Section[]>([])
  const unitEntries   = ref<RelationEntry[]>([])
  const unitTargets   = ref<RelationTarget[]>([])
  const operationEntries = ref<RelationEntry[]>([])
  const operationTargets = ref<RelationTarget[]>([])
  const incidentEntries  = ref<RelationEntry[]>([])
  const incidentTargets  = ref<RelationTarget[]>([])
  const people        = ref<DeltakerLink[]>([])
  const externalRefs  = ref<ExternalRef[]>([])
  const galleryImages = ref<SlideImage[]>([])

  function resetOrg() {
    org.value              = null
    savedSections.value    = []
    unitEntries.value      = []
    unitTargets.value      = []
    operationEntries.value = []
    operationTargets.value = []
    incidentEntries.value  = []
    incidentTargets.value  = []
    people.value           = []
    externalRefs.value     = []
    galleryImages.value    = []
  }

  async function loadOrg(slug: string) {
    // Create mode — `/organization/new` lands here before the node exists.
    // Populate `org` with a blank skeleton so the page renders the edit form
    // instead of the "ikke funnet" state; skip all relation/gallery fetches.
    if (slug === 'new') {
      org.value = {
        name: '', formalName: null, abbreviation: null, sortingName: null,
        color: null, foundedDate: null, dissolvedDate: null, country: null,
      }
      return
    }
    try {
      const [
        orgRows, sectionRows,
        fetchedUnitEntries, fetchedUnitTargets,
        opEntries, opTargets, incEntries, incTargets,
        peopleRows, refRows, galleryRows,
      ] = await Promise.all([
        neo4jQuery<OrgNode>(
          `MATCH (o:Organization {slug: $slug})
           RETURN o.canonicalName AS name,
                  o.formalName    AS formalName,
                  o.abbreviation  AS abbreviation,
                  o.sortingName   AS sortingName,
                  o.color         AS color,
                  o.foundedDate   AS foundedDate,
                  o.dissolvedDate AS dissolvedDate,
                  o.country       AS country`,
          { slug },
        ),
        // Descriptions — HAS_CONTENT sections, same shape as Person sections.
        neo4jQuery<SectionRow>(
          `MATCH (o:Organization {slug: $slug})-[:HAS_CONTENT]->(d:Description)
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
        // Sub-units — PART_OF edges carry role/order, plus a
        // HAS_MEMBER_UNIT_NOTE Description (rendered via the relation popup
        // as the unit's annotation on this org's roster).
        OrganizationUnitsStrategy.fetchEntries(slug),
        OrganizationUnitsStrategy.fetchTargets(),
        // Operasjoner / Hendelser ORCHESTRATED_BY this org — editor manages
        // the edge set; "+ Opprett ny" inside the picker jumps to
        // AdminEventNewView with ?forOrg= for new event creation.
        OrgOperationsStrategy.fetchEntries(slug),
        OrgOperationsStrategy.fetchTargets(),
        OrgIncidentsStrategy.fetchEntries(slug),
        OrgIncidentsStrategy.fetchTargets(),
        // Participants reached via Incidents (empty until round 3).
        neo4jQuery<DeltakerLink>(
          `MATCH (o:Organization {slug: $slug})<-[:ORCHESTRATED_BY]-(i:Incident|Operation)<-[:INVOLVED_IN|PARTICIPATED_IN]-(p:Person)
           RETURN DISTINCT p.slug AS slug, p.canonicalName AS name, count(i) AS eventCount
           ORDER BY eventCount DESC`,
          { slug },
        ),
        // External references — Sources this Organization is REFERENCED_IN.
        neo4jQuery<ExternalRef>(
          `MATCH (o:Organization {slug: $slug})-[:REFERENCED_IN]->(s:Source)
           RETURN s.id AS id, s.title AS title, s.url AS url,
                  s.type AS type, s.domain AS domain,
                  coalesce(s.nbBacked, false) AS nbBacked
           ORDER BY nbBacked DESC, s.type, coalesce(s.title, s.url)`,
          { slug },
        ),
        // Gallery — buckets: 0 own, 1 operations, 2 units, 3 incidents, 4 people.
        // HAS_IMAGE.scope = 'entity' pins a Source to its attachment and is
        // filtered out of every propagating hop.
        neo4jQuery<{ url: string; caption: string | null; subjectName: string; subjectSlug: string; subjectType: string; sortKey: number }>(
          `CALL {
             MATCH (o:Organization {slug: $slug})-[h:HAS_IMAGE]->(s:Source)
             RETURN s.url AS url, h.caption AS caption,
                    o.canonicalName AS subjectName, o.slug AS subjectSlug,
                    'organization' AS subjectType, 0 AS sortKey
             UNION
             MATCH (o:Organization {slug: $slug})<-[:ORCHESTRATED_BY]-(op:Operation)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
             RETURN s.url AS url, h.caption AS caption,
                    op.codeName AS subjectName, op.slug AS subjectSlug,
                    'operation' AS subjectType, 1 AS sortKey
             UNION
             MATCH (o:Organization {slug: $slug})<-[:PART_OF*1..]-(u:Unit)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
             RETURN s.url AS url, h.caption AS caption,
                    u.canonicalName AS subjectName, u.slug AS subjectSlug,
                    'unit' AS subjectType, 2 AS sortKey
             UNION
             MATCH (o:Organization {slug: $slug})<-[:ORCHESTRATED_BY]-(i:Incident)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
             RETURN s.url AS url, h.caption AS caption,
                    i.title AS subjectName, i.slug AS subjectSlug,
                    'incident' AS subjectType, 3 AS sortKey
             UNION
             MATCH (o:Organization {slug: $slug})<-[:PART_OF*1..]-(:Unit)<-[:MEMBER_OF]-(p:Person)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
             RETURN s.url AS url, h.caption AS caption,
                    p.canonicalName AS subjectName, p.slug AS subjectSlug,
                    'person' AS subjectType, 4 AS sortKey
           }
           RETURN url, caption, subjectName, subjectSlug, subjectType, sortKey
           ORDER BY sortKey, subjectName
           LIMIT 200`,
          { slug },
        ),
      ])

      org.value              = orgRows[0] ?? null
      unitEntries.value      = fetchedUnitEntries
      unitTargets.value      = fetchedUnitTargets
      operationEntries.value = opEntries
      operationTargets.value = opTargets
      incidentEntries.value  = incEntries
      incidentTargets.value  = incTargets
      people.value           = peopleRows
      externalRefs.value     = refRows

      // Dedupe by URL (same Source can surface via multiple traversals).
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

      savedSections.value = sectionRows.map(rowToSection)
    } catch (err) {
      console.error('[useOrganizationData] load failed:', err)
      org.value = null
    }
  }

  return {
    // Refs
    org,
    savedSections,
    unitEntries,      unitTargets,
    operationEntries, operationTargets,
    incidentEntries,  incidentTargets,
    people,
    externalRefs,
    galleryImages,
    // Lifecycle
    loadOrg,
    resetOrg,
  }
}
