/**
 * useUnitData — owns the Neo4j data layer for a Unit (district) detail
 * page. Mirrors useOrganizationData / usePersonData.
 *
 * Returns the reactive refs every section consumes (unit core fields,
 * editable HAS_CONTENT sections, legacy ABOUT descriptions, parents,
 * sub-units, training courses, members, incidents, gallery, external
 * refs) plus `loadUnit(slug)` and `resetUnit()` for the page's
 * DetailPage callbacks.
 *
 * Two description models coexist on Unit:
 *  - `savedSections` (HAS_CONTENT) — the new editor model, mirror of
 *    Org/Person; managed by SectionsEditor.
 *  - `legacyDescriptions` (ABOUT) — the sanity-outline-migration stack
 *    (multi-author/recordedDate). Rendered read-only by the ViewPane
 *    until a future migration converts them to HAS_CONTENT.
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import type { SlideImage } from '@/components/ImageSlider.vue'
import type { Section } from '@/components/SectionsEditor.vue'

export interface UnitNode {
  name:          string
  formalName:    string | null
  type:          string | null
  color:         string | null
  foundedDate:   string | null
  dissolvedDate: string | null
  country:       string | null
}

export interface LegacyDescription {
  content:      string | null
  recordedDate: string | null
  author:       string | null
  sourceRefs:   string[] | null
}

export interface UnitParent {
  name:        string
  slug:        string
  label:       'Organization' | 'Unit'
  color:       string | null
  role:        string | null
  description: string | null
  sourceRefs:  string[] | null
  order:       number
}

export interface UnitMember {
  slug:        string
  name:        string
  rank:        string | null
  status:      string | null
  role:        string | null
  description: string | null
  sourceRefs:  string[] | null
  startDate:   string | null
  endDate:     string | null
}

export interface UnitCourse {
  slug:         string
  letter:       string
  startDate:    string | null
  studentCount: number
  missingCount: number
  targetGroup:  string | null
}

export interface UnitEvent { slug: string; title: string; date: string | null }
export interface UnitSubUnit { name: string; slug: string }
export interface UnitExternalRef {
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

export function useUnitData() {
  const unit               = ref<UnitNode | null>(null)
  const savedSections      = ref<Section[]>([])
  const legacyDescriptions = ref<LegacyDescription[]>([])
  const parents            = ref<UnitParent[]>([])
  const subUnits           = ref<UnitSubUnit[]>([])
  const courses            = ref<UnitCourse[]>([])
  const members            = ref<UnitMember[]>([])
  const events             = ref<UnitEvent[]>([])
  const externalRefs       = ref<UnitExternalRef[]>([])
  const galleryImages      = ref<SlideImage[]>([])

  function resetUnit() {
    unit.value               = null
    savedSections.value      = []
    legacyDescriptions.value = []
    parents.value            = []
    subUnits.value           = []
    courses.value            = []
    members.value            = []
    events.value             = []
    externalRefs.value       = []
    galleryImages.value      = []
  }

  async function loadUnit(slug: string) {
    // Create mode — `/district/new` lands here before the node exists.
    if (slug === 'new') {
      unit.value = {
        name: '', formalName: null, type: null, color: null,
        foundedDate: null, dissolvedDate: null, country: null,
      }
      return
    }
    try {
      const [
        unitRows, sectionRows, legacyRows,
        parentRows, subUnitRows, memberRows,
        eventRows, courseRows, refRows, galleryRows,
      ] = await Promise.all([
        neo4jQuery<UnitNode>(
          `MATCH (u:Unit {slug: $slug})
           RETURN u.canonicalName AS name,
                  u.formalName    AS formalName,
                  u.type          AS type,
                  u.color         AS color,
                  u.foundedDate   AS foundedDate,
                  u.dissolvedDate AS dissolvedDate,
                  u.country       AS country`,
          { slug },
        ),
        // HAS_CONTENT sections — editor model, mirror of Org/Person.
        neo4jQuery<SectionRow>(
          `MATCH (u:Unit {slug: $slug})-[:HAS_CONTENT]->(d:Description)
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
        // Legacy ABOUT descriptions — read-only stack from
        // sanity-outline-migration. Future task: migrate to HAS_CONTENT.
        neo4jQuery<{ content: string | null; recordedDate: string | null; author: string | null; sourceRefs: string[] }>(
          `MATCH (d:Description)-[:ABOUT]->(u:Unit {slug: $slug})
           OPTIONAL MATCH (d)-[:FROM]->(s:Source)
           WITH d, collect(s.id) AS sourceRefs
           RETURN d.content AS content,
                  d.recordedDate AS recordedDate,
                  d.author AS author,
                  [x IN sourceRefs WHERE x IS NOT NULL] AS sourceRefs
           ORDER BY d.recordedDate DESC, d.id`,
          { slug },
        ),
        // Parents — PART_OF edges with role/description/order.
        neo4jQuery<UnitParent>(
          `MATCH (u:Unit {slug: $slug})-[r:PART_OF]->(parent)
           WHERE parent:Organization OR parent:Unit
           RETURN parent.canonicalName AS name,
                  parent.slug          AS slug,
                  labels(parent)[0]    AS label,
                  parent.color         AS color,
                  r.role               AS role,
                  r.description        AS description,
                  r.sourceRefs         AS sourceRefs,
                  coalesce(r.order, 999) AS \`order\`
           ORDER BY CASE WHEN r.description IS NOT NULL THEN 1 ELSE 0 END,
                    \`order\`, name`,
          { slug },
        ),
        // Sub-units — exclude training courses (own table below).
        neo4jQuery<UnitSubUnit>(
          `MATCH (child:Unit)-[:PART_OF]->(u:Unit {slug: $slug})
           WHERE child.type IS NULL OR child.type <> 'course'
           RETURN child.canonicalName AS name, child.slug AS slug
           ORDER BY name`,
          { slug },
        ),
        // Members — with rank (skip Menig baseline) + status + edge meta.
        neo4jQuery<UnitMember>(
          `MATCH (p:Person)-[m:MEMBER_OF]->(:Unit)-[:PART_OF*0..]->(u:Unit {slug: $slug})
           OPTIONAL MATCH (p)-[:RANK]->(r:Rank)
           WHERE r.canonicalName <> 'Menig'
           WITH p, r, collect(m) AS edges
           WITH p, r,
                head([e IN edges WHERE e.description IS NOT NULL] + edges) AS m
           RETURN p.slug AS slug, p.canonicalName AS name,
                  r.abbreviation AS rank, p.status AS status,
                  m.role AS role, m.description AS description,
                  m.sourceRefs AS sourceRefs,
                  m.startDate AS startDate, m.endDate AS endDate
           ORDER BY CASE WHEN m.description IS NOT NULL THEN 1 ELSE 0 END,
                    name`,
          { slug },
        ),
        // Incidents — filtered by unit lifetime.
        neo4jQuery<UnitEvent>(
          `MATCH (u:Unit {slug: $slug})<-[:MEMBER_OF]-(p:Person)-[:INVOLVED_IN]->(i:Incident)
           WHERE i.date IS NULL
              OR (
                (u.foundedDate   IS NULL OR i.date >= u.foundedDate) AND
                (u.dissolvedDate IS NULL OR i.date <= u.dissolvedDate)
              )
           RETURN DISTINCT i.slug AS slug, i.title AS title, i.date AS date
           ORDER BY date`,
          { slug },
        ),
        // Training courses — Unit{type:"course"} children.
        neo4jQuery<UnitCourse>(
          `MATCH (c:Unit {type: 'course'})-[:PART_OF]->(u:Unit {slug: $slug})
           RETURN c.slug AS slug, c.courseLetter AS letter,
                  c.startDate AS startDate, c.studentCount AS studentCount,
                  c.missingCount AS missingCount, c.targetGroup AS targetGroup
           ORDER BY c.order`,
          { slug },
        ),
        // External refs — Sources REFERENCED_IN.
        neo4jQuery<UnitExternalRef>(
          `MATCH (u:Unit {slug: $slug})-[:REFERENCED_IN]->(s:Source)
           RETURN s.id AS id, s.title AS title, s.url AS url,
                  s.type AS type, s.domain AS domain,
                  coalesce(s.nbBacked, false) AS nbBacked
           ORDER BY nbBacked DESC, s.type, coalesce(s.title, s.url)`,
          { slug },
        ),
        // Gallery — buckets: 0 own, 1 operations, 2 parent org, 3 incidents, 4 people.
        neo4jQuery<{ url: string; caption: string | null; subjectName: string; subjectSlug: string; subjectType: string; sortKey: number }>(
          `MATCH (unit:Unit {slug: $slug})
           CALL {
             WITH unit
             MATCH (unit)-[h:HAS_IMAGE]->(s:Source)
             RETURN s.url AS url, h.caption AS caption,
                    unit.canonicalName AS subjectName, unit.slug AS subjectSlug,
                    'unit' AS subjectType, 0 AS sortKey
             UNION
             WITH unit
             MATCH (unit)<-[:MEMBER_OF]-(:Person)-[:INVOLVED_IN]->(i:Incident)<-[:RELATED_TO {kind:'contains'}]-(op:Operation)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
               AND (i.date IS NULL OR (
                 (unit.foundedDate   IS NULL OR i.date >= unit.foundedDate) AND
                 (unit.dissolvedDate IS NULL OR i.date <= unit.dissolvedDate)
               ))
             RETURN s.url AS url, h.caption AS caption,
                    op.codeName AS subjectName, op.slug AS subjectSlug,
                    'operation' AS subjectType, 1 AS sortKey
             UNION
             WITH unit
             MATCH (unit)-[:PART_OF*1..]->(o:Organization)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
             RETURN s.url AS url, h.caption AS caption,
                    o.canonicalName AS subjectName, o.slug AS subjectSlug,
                    'organization' AS subjectType, 2 AS sortKey
             UNION
             WITH unit
             MATCH (unit)<-[:MEMBER_OF]-(:Person)-[:INVOLVED_IN]->(i:Incident)-[h:HAS_IMAGE]->(s:Source)
             WHERE coalesce(h.scope, 'propagate') <> 'entity'
               AND (i.date IS NULL OR (
                 (unit.foundedDate   IS NULL OR i.date >= unit.foundedDate) AND
                 (unit.dissolvedDate IS NULL OR i.date <= unit.dissolvedDate)
               ))
             RETURN s.url AS url, h.caption AS caption,
                    i.title AS subjectName, i.slug AS subjectSlug,
                    'incident' AS subjectType, 3 AS sortKey
             UNION
             WITH unit
             MATCH (unit)<-[:MEMBER_OF]-(p:Person)-[h:HAS_IMAGE]->(s:Source)
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

      unit.value         = unitRows[0] ?? null
      parents.value      = parentRows
      subUnits.value     = subUnitRows
      members.value      = memberRows
      events.value       = eventRows
      courses.value      = courseRows
      externalRefs.value = refRows

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

      savedSections.value      = sectionRows.map(rowToSection)
      legacyDescriptions.value = legacyRows
    } catch (err) {
      console.error('[useUnitData] load failed:', err)
      unit.value = null
    }
  }

  return {
    // Refs
    unit,
    savedSections,
    legacyDescriptions,
    parents,
    subUnits,
    courses,
    members,
    events,
    externalRefs,
    galleryImages,
    // Lifecycle
    loadUnit,
    resetUnit,
  }
}
