/**
 * useEventData — Neo4j data layer shared by Operation + Incident.
 *
 * Both kinds live in EventDetail.vue today; the page hasn't been
 * refactored to inject this yet. The composable exists for the
 * proposal-preview wrapper so bundles touching Operation/Incident can
 * render a focused preview without pulling in the rest of the page.
 *
 * Returned refs cover the Neo4j-sourced shape (kind, name, date,
 * description sections, the four relation arrays). Sanity-IDB extras
 * (gallery, movie, legacy descriptions) stay in EventDetail.vue.
 */
import { ref, computed } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import {
  PersonInvolvementStrategy, PersonParticipationStrategy,
  SubIncidentsStrategy, SubOperationsStrategy, OperationIncidentsStrategy,
} from '@/components/relation/strategies.ts'

export type EventKind = 'incident' | 'operation'

export interface EventNode {
  slug:          string
  kind:          EventKind
  canonicalName: string
  date:          string | null
}

export interface EventLocationRef {
  slug:  string
  title: string
  lat:   number | null
  lng:   number | null
}

export interface EventStationRef {
  slug:  string
  title: string
}

export interface EventGalleryImage {
  id:      string
  url:     string | null
  caption: string | null
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

export function useEventData() {
  const event         = ref<EventNode | null>(null)
  const savedSections = ref<Section[]>([])

  const locationFrom = ref<EventLocationRef | null>(null)
  const locationTo   = ref<EventLocationRef | null>(null)
  const stationFrom  = ref<EventStationRef  | null>(null)
  const stationTo    = ref<EventStationRef  | null>(null)
  const gallery      = ref<EventGalleryImage[]>([])

  const personEntries        = ref<RelationEntry[]>([])
  const personTargets        = ref<RelationTarget[]>([])
  const subIncidentEntries   = ref<RelationEntry[]>([])
  const subIncidentTargets   = ref<RelationTarget[]>([])
  const subOperationEntries  = ref<RelationEntry[]>([])
  const subOperationTargets  = ref<RelationTarget[]>([])
  const opIncidentEntries    = ref<RelationEntry[]>([])
  const opIncidentTargets    = ref<RelationTarget[]>([])

  const personStrategy = computed(() =>
    event.value?.kind === 'operation' ? PersonParticipationStrategy : PersonInvolvementStrategy,
  )

  function resetEvent() {
    event.value                = null
    savedSections.value        = []
    locationFrom.value         = null
    locationTo.value           = null
    stationFrom.value          = null
    stationTo.value            = null
    gallery.value              = []
    personEntries.value        = []
    personTargets.value        = []
    subIncidentEntries.value   = []
    subIncidentTargets.value   = []
    subOperationEntries.value  = []
    subOperationTargets.value  = []
    opIncidentEntries.value    = []
    opIncidentTargets.value    = []
  }

  async function loadEvent(slug: string): Promise<void> {
    if (slug === 'new') {
      event.value = { slug: '', kind: 'incident', canonicalName: '', date: null }
      return
    }
    const rows = await neo4jQuery<{ kind: EventKind; name: string | null; date: string | null }>(
      `MATCH (n {slug: $slug})
       WHERE n:Incident OR n:Operation
       RETURN CASE WHEN 'Operation' IN labels(n) THEN 'operation' ELSE 'incident' END AS kind,
              coalesce(n.codeName, n.canonicalName, n.title) AS name,
              n.date AS date`,
      { slug },
    )
    const row = rows[0]
    if (!row) {
      event.value = null
      return
    }
    event.value = {
      slug,
      kind:          row.kind,
      canonicalName: row.name ?? slug,
      date:          row.date,
    }

    const kindLabel = row.kind === 'operation' ? 'Operation' : 'Incident'
    const [descRows, persons, personTargetsList, locFromRows, locToRows, stFromRows, stToRows, galleryRows] = await Promise.all([
      neo4jQuery<SectionRow>(
        `MATCH (:\`${kindLabel}\` {slug: $slug})-[:HAS_CONTENT]->(d:Description)
         RETURN d.order AS order, d.content AS content
         ORDER BY coalesce(d.order, 1) ASC`,
        { slug },
      ),
      personStrategy.value.fetchEntries(slug),
      personStrategy.value.fetchTargets(),
      neo4jQuery<EventLocationRef>(
        `MATCH (:\`${kindLabel}\` {slug: $slug})-[:FROM]->(l:Location)
         RETURN l.slug AS slug, coalesce(l.canonicalName, l.title) AS title, l.lat AS lat, l.lng AS lng`,
        { slug },
      ),
      neo4jQuery<EventLocationRef>(
        `MATCH (:\`${kindLabel}\` {slug: $slug})-[:TO]->(l:Location)
         RETURN l.slug AS slug, coalesce(l.canonicalName, l.title) AS title, l.lat AS lat, l.lng AS lng`,
        { slug },
      ),
      neo4jQuery<EventStationRef>(
        `MATCH (:\`${kindLabel}\` {slug: $slug})-[:FROM_STATION]->(s:Station)
         RETURN s.slug AS slug, coalesce(s.canonicalName, s.title) AS title`,
        { slug },
      ),
      neo4jQuery<EventStationRef>(
        `MATCH (:\`${kindLabel}\` {slug: $slug})-[:TO_STATION]->(s:Station)
         RETURN s.slug AS slug, coalesce(s.canonicalName, s.title) AS title`,
        { slug },
      ),
      neo4jQuery<EventGalleryImage>(
        `MATCH (:\`${kindLabel}\` {slug: $slug})-[r:HAS_IMAGE]->(s:Source)
         WHERE coalesce(s.kind, 'photograph') = 'photograph'
         RETURN s.id AS id, s.url AS url, coalesce(r.caption, s.title) AS caption
         ORDER BY coalesce(r.order, 9999), s.id`,
        { slug },
      ),
    ])
    savedSections.value = descRows.map(rowToSection)
    personEntries.value = persons
    personTargets.value = personTargetsList
    locationFrom.value  = locFromRows[0] ?? null
    locationTo.value    = locToRows[0]   ?? null
    stationFrom.value   = stFromRows[0]  ?? null
    stationTo.value     = stToRows[0]    ?? null
    gallery.value       = galleryRows

    if (row.kind === 'incident') {
      const [se, st] = await Promise.all([
        SubIncidentsStrategy.fetchEntries(slug),
        SubIncidentsStrategy.fetchTargets(),
      ])
      subIncidentEntries.value = se
      subIncidentTargets.value = st
    } else {
      const [so, sot, oi, oit] = await Promise.all([
        SubOperationsStrategy.fetchEntries(slug),
        SubOperationsStrategy.fetchTargets(),
        OperationIncidentsStrategy.fetchEntries(slug),
        OperationIncidentsStrategy.fetchTargets(),
      ])
      subOperationEntries.value = so
      subOperationTargets.value = sot
      opIncidentEntries.value   = oi
      opIncidentTargets.value   = oit
    }
  }

  return {
    event,
    savedSections,
    locationFrom, locationTo,
    stationFrom,  stationTo,
    gallery,
    personEntries, personTargets,
    subIncidentEntries, subIncidentTargets,
    subOperationEntries, subOperationTargets,
    opIncidentEntries,  opIncidentTargets,
    loadEvent,
    resetEvent,
  }
}
