/**
 * useEventsList — Neo4j-backed list of Incident + Operation nodes.
 *
 * Returns the same `IdbEvent`-shaped rows the Sanity-IDB list emitted,
 * so EventsView's filtering, virtual scroll, and thumbnail rendering
 * keep working without further changes when this swaps in.
 *
 * Thumbnail is read from the first HAS_IMAGE → Source(kind='photograph')
 * if any; otherwise undefined and the list shows the placeholder.
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import { descriptionBlocks } from '../utils/descriptionBlocks.ts'
import type { IdbEvent, IdbEventDetail } from '../types/idb.ts'

interface EventRow {
  slug:         string
  title:        string | null
  date:         string | null
  organization: string | null
  district:     string | null
  thumbnailUrl: string | null
}

export function useEventsList() {
  const events  = ref<IdbEvent[]>([])
  const loading = ref(false)
  const loaded  = ref(false)

  async function init(): Promise<void> {
    if (loaded.value || loading.value) return
    loading.value = true
    try {
      const rows = await neo4jQuery<EventRow>(
        `MATCH (e) WHERE e:Incident OR e:Operation
         OPTIONAL MATCH (e)-[:ORCHESTRATED_BY]->(org:Organization)
         OPTIONAL MATCH (e)-[:IN_DISTRICT]->(dist:Unit)
         OPTIONAL MATCH (e)-[:HAS_IMAGE]->(img:Source)
           WHERE coalesce(img.kind, 'photograph') = 'photograph'
         WITH e, org, dist, img ORDER BY coalesce(img.id, '')
         WITH e, org, dist, head(collect(img)) AS firstImg
         RETURN e.slug AS slug,
                coalesce(e.codeName, e.canonicalName, e.title) AS title,
                e.date AS date,
                org.canonicalName AS organization,
                dist.canonicalName AS district,
                firstImg.url AS thumbnailUrl
         ORDER BY e.date ASC, title ASC`,
      )
      events.value = rows
        .filter((r) => r.slug && r.title)
        .map((r): IdbEvent => ({
          _id:          r.slug,
          slug:         r.slug,
          title:        r.title!,
          date:         r.date         ?? undefined,
          organization: r.organization ?? undefined,
          district:     r.district     ?? undefined,
          thumbnailUrl: r.thumbnailUrl ?? undefined,
        }))
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /**
   * Patch a cached row after a slug rename. The list is fetched once per
   * EventsView mount, so without this the renamed event is unreachable by
   * its new slug until a full reload.
   */
  function renameEvent(oldSlug: string, newSlug: string): void {
    const row = events.value.find(e => e.slug === oldSlug)
    if (!row) return
    row.slug = newSlug
    row._id  = newSlug
  }

  return { events, loading, init, renameEvent }
}

/**
 * One-shot Neo4j detail fetch for a single Incident/Operation slug,
 * shaped as IdbEventDetail so EventPanel can consume it without
 * conditional rendering. Returns null when the node doesn't exist.
 *
 * Used as a fallback when Sanity-IDB has no entry for the slug.
 */
export async function fetchEventDetailFromNeo4j(slug: string): Promise<IdbEventDetail | null> {
  const headRows = await neo4jQuery<{
    kind: 'operation' | 'incident'
    title: string | null
    date: string | null
    organization: string | null
    district: string | null
  }>(
    `MATCH (e {slug: $slug}) WHERE e:Incident OR e:Operation
     OPTIONAL MATCH (e)-[:ORCHESTRATED_BY]->(org:Organization)
     OPTIONAL MATCH (e)-[:IN_DISTRICT]->(dist:Unit)
     RETURN CASE WHEN 'Operation' IN labels(e) THEN 'operation' ELSE 'incident' END AS kind,
            coalesce(e.codeName, e.canonicalName, e.title) AS title,
            e.date AS date,
            org.canonicalName AS organization,
            dist.canonicalName AS district`,
    { slug },
  )
  const head = headRows[0]
  if (!head) return null

  const kindLabel = head.kind === 'operation' ? 'Operation' : 'Incident'
  // Incidents collapsed FROM/TO into single AT (location + station). Read
  // the right edges per kind so the preview renders cleanly. The IDB shape
  // still has only locationFrom/stationFrom slots, so the AT edge maps in
  // there for incidents — EventPanel relabels by `event.kind`.
  const locFromEdge   = kindLabel === 'Operation' ? '[:FROM]'         : '[:AT]'
  const locToEdge     = kindLabel === 'Operation' ? '[:TO]'           : '[:AT]'   // unused for incidents
  const stFromEdge    = kindLabel === 'Operation' ? '[:FROM_STATION]' : '[:AT_STATION]'
  const stToEdge      = kindLabel === 'Operation' ? '[:TO_STATION]'   : '[:AT_STATION]'

  const [descRows, aboutRows, locFromRows, locToRows, stFromRows, stToRows, peopleRows, galleryRows] = await Promise.all([
    neo4jQuery<{ content: string | null }>(
      `MATCH (:\`${kindLabel}\` {slug: $slug})-[:HAS_CONTENT]->(d:Description)
       RETURN d.content AS content
       ORDER BY coalesce(d.order, 1) ASC`,
      { slug },
    ),
    // The text imported from Sanity (scripts/sync-event.ts) is stored the other
    // way round: (Description)-[:ABOUT]->(event). Used below when the event has
    // no HAS_CONTENT sections.
    neo4jQuery<{ content: string | null }>(
      `MATCH (d:Description)-[:ABOUT]->(:\`${kindLabel}\` {slug: $slug})
       RETURN d.content AS content
       ORDER BY coalesce(d.order, 1) ASC`,
      { slug },
    ),
    neo4jQuery<{ slug: string; title: string }>(
      `MATCH (:\`${kindLabel}\` {slug: $slug})-${locFromEdge}->(l:Location)
       RETURN l.slug AS slug, coalesce(l.canonicalName, l.title) AS title`,
      { slug },
    ),
    kindLabel === 'Operation'
      ? neo4jQuery<{ slug: string; title: string }>(
          `MATCH (:\`${kindLabel}\` {slug: $slug})-${locToEdge}->(l:Location)
           RETURN l.slug AS slug, coalesce(l.canonicalName, l.title) AS title`,
          { slug },
        )
      : Promise.resolve([] as { slug: string; title: string }[]),
    neo4jQuery<{ slug: string; title: string }>(
      `MATCH (:\`${kindLabel}\` {slug: $slug})-${stFromEdge}->(s:Station)
       RETURN s.slug AS slug, coalesce(s.canonicalName, s.title) AS title`,
      { slug },
    ),
    kindLabel === 'Operation'
      ? neo4jQuery<{ slug: string; title: string }>(
          `MATCH (:\`${kindLabel}\` {slug: $slug})-${stToEdge}->(s:Station)
           RETURN s.slug AS slug, coalesce(s.canonicalName, s.title) AS title`,
          { slug },
        )
      : Promise.resolve([] as { slug: string; title: string }[]),
    neo4jQuery<{ slug: string; name: string }>(
      `MATCH (p:Person)-[:INVOLVED_IN|PARTICIPATED_IN]->(:\`${kindLabel}\` {slug: $slug})
       RETURN DISTINCT p.slug AS slug, p.canonicalName AS name
       ORDER BY name`,
      { slug },
    ),
    neo4jQuery<{ id: string; url: string | null; caption: string | null }>(
      `MATCH (:\`${kindLabel}\` {slug: $slug})-[r:HAS_IMAGE]->(s:Source)
       WHERE coalesce(s.kind, 'photograph') = 'photograph'
       RETURN s.id AS id, s.url AS url, coalesce(r.caption, s.title) AS caption
       ORDER BY coalesce(r.order, 9999), s.id`,
      { slug },
    ),
  ])

  // Synthesize PT description blocks from the Description content
  // strings (each Description holds a JSON-stringified PT array).
  // Sections written in the app win; the imported ABOUT text shows only until
  // an editor has written sections of their own.
  const description = descriptionBlocks(descRows.length ? descRows : aboutRows)

  // Gallery shape mirrors Sanity's; consumers read .url first, asset second.
  const gallery = galleryRows.map((g) => ({
    asset:   { _ref: g.id, _type: 'reference' as const },
    url:     g.url,
    caption: g.caption,
  }))

  return {
    _id:          slug,
    title:        head.title ?? slug,
    slug,
    kind:         head.kind,
    date:         head.date ?? undefined,
    organization: head.organization ?? undefined,
    district:     head.district     ?? undefined,
    description: description.length ? description : undefined,
    locationFrom: locFromRows[0] ?? undefined,
    locationTo:   locToRows[0]   ?? undefined,
    stationFrom:  stFromRows[0]  ?? undefined,
    stationTo:    stToRows[0]    ?? undefined,
    people:       peopleRows.length ? peopleRows : undefined,
    gallery:      gallery.length    ? gallery    : undefined,
    thumbnailUrl: gallery[0]?.url ?? undefined,
  } as IdbEventDetail
}
