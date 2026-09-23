/**
 * useEquipmentData — Neo4j data layer for an EquipmentType detail page.
 * Mirror of useLocationData / useStationData.
 *
 * Descriptions: editable sections via HAS_CONTENT; the migrated outline
 * text lives on legacy `(d:Description)-[:ABOUT]->(e)` nodes and renders
 * read-only as "Beskrivelse (arkiv)" (same as Unit) until migrated.
 *
 * Relations:
 *  - (e)-[:PAIRED_WITH]-(:EquipmentType) — Paret med (symmetric)
 *  - (e)-[:REFERENCED_IN]->(:Source)     — Lenker
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import { EquipmentPairedStrategy } from '@/components/relation/strategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import type { Section } from '@/components/SectionsEditor.vue'

export interface EquipmentNode {
  slug:          string
  canonicalName: string
  type:          string | null
  subtype:       string | null
  country:       string | null
  period:        string | null
}

export interface EquipmentLegacyDescription { content: string | null }
export interface EquipmentExternalRef {
  id: string; title: string | null; url: string;
  type: string; domain: string | null; nbBacked: boolean
}

/** Norwegian labels for the schema's type vocabulary. */
export const EQUIPMENT_TYPE_LABEL: Record<string, string> = {
  'radio':             'Radio',
  'navigation':        'Navigasjon',
  'weapon':            'Våpen',
  'explosive':         'Sprengstoff',
  'survival':          'Overlevelse',
  'vehicle-accessory': 'Kjøretøyutstyr',
  'medical':           'Sanitet',
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

export function useEquipmentData() {
  const equipment          = ref<EquipmentNode | null>(null)
  const savedSections      = ref<Section[]>([])
  const legacyDescriptions = ref<EquipmentLegacyDescription[]>([])
  const externalRefs       = ref<EquipmentExternalRef[]>([])
  // Shared by the edit pane (RelationListEditor mutates entries in
  // place on save) and the view pane.
  const paired = ref<{ entries: RelationEntry[]; targets: RelationTarget[] }>({ entries: [], targets: [] })

  function resetEquipment() {
    equipment.value          = null
    savedSections.value      = []
    legacyDescriptions.value = []
    externalRefs.value       = []
    paired.value             = { entries: [], targets: [] }
  }

  async function loadEquipment(slug: string): Promise<void> {
    if (slug === 'new') {
      equipment.value = { slug: '', canonicalName: '', type: null, subtype: null, country: null, period: null }
      paired.value.targets = await EquipmentPairedStrategy.fetchTargets().catch(() => [])
      return
    }
    try {
      const [rows, sectionRows, legacyRows, refRows, pairedEntries, pairedTargets] = await Promise.all([
        // trim(): migrated names carry stray whitespace ("OLGA ").
        neo4jQuery<EquipmentNode>(
          `MATCH (e:EquipmentType {slug: $slug})
           RETURN e.slug AS slug, trim(e.canonicalName) AS canonicalName,
                  e.type AS type, e.subtype AS subtype,
                  e.country AS country, e.period AS period`,
          { slug },
        ),
        neo4jQuery<SectionRow>(
          `MATCH (e:EquipmentType {slug: $slug})-[:HAS_CONTENT]->(d:Description)
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
        neo4jQuery<EquipmentLegacyDescription>(
          `MATCH (d:Description)-[:ABOUT]->(:EquipmentType {slug: $slug})
           RETURN d.content AS content
           ORDER BY coalesce(d.order, 1), d.id`,
          { slug },
        ),
        neo4jQuery<EquipmentExternalRef>(
          `MATCH (:EquipmentType {slug: $slug})-[:REFERENCED_IN]->(src:Source)
           RETURN src.id AS id, src.title AS title, src.url AS url,
                  src.type AS type, src.domain AS domain,
                  coalesce(src.nbBacked, false) AS nbBacked
           ORDER BY nbBacked DESC, src.type, coalesce(src.title, src.url)`,
          { slug },
        ),
        EquipmentPairedStrategy.fetchEntries(slug),
        EquipmentPairedStrategy.fetchTargets(),
      ])

      equipment.value          = rows[0] ?? null
      savedSections.value      = sectionRows.map(rowToSection)
      legacyDescriptions.value = legacyRows
      externalRefs.value       = refRows
      paired.value             = { entries: pairedEntries, targets: pairedTargets.filter(t => t.slug !== slug) }
    } catch (err) {
      console.error('[useEquipmentData] load failed:', err)
      equipment.value = null
    }
  }

  return {
    equipment,
    savedSections,
    legacyDescriptions,
    externalRefs,
    paired,
    loadEquipment,
    resetEquipment,
  }
}
