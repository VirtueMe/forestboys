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
import type { IdbEvent } from '../types/idb.ts'

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

  return { events, loading, init }
}
