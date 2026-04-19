/**
 * Session-scoped cache + batch resolver for Source nodes referenced by
 * sourceRef strings (see schema: `<source-id>[#<kind>:<entry>[,<entry>]*]`).
 *
 * Callers pass the parsed *id* part (before the '#'). Fragments are rendered
 * client-side by SourceRef.vue — they don't affect the lookup.
 */
import { reactive } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'

export interface ResolvedSource {
  id:     string
  type:   string | null
  title:  string | null
  url:    string | null
  domain: string | null
}

type CacheEntry = ResolvedSource | null

const cache    = reactive<Record<string, CacheEntry>>({})
const inflight = new Map<string, Promise<void>>()

export function getCachedSource(id: string): ResolvedSource | null {
  return cache[id] ?? null
}

export async function resolveSources(ids: string[]): Promise<void> {
  const missing = [...new Set(ids)].filter(id => !(id in cache) && !inflight.has(id))
  if (missing.length === 0) return
  const promise = (async () => {
    try {
      const rows = await neo4jQuery<ResolvedSource>(
        `MATCH (s:Source) WHERE s.id IN $ids
         RETURN s.id AS id, s.type AS type, s.title AS title, s.url AS url, s.domain AS domain`,
        { ids: missing },
      )
      const found = new Set<string>()
      for (const row of rows) {
        cache[row.id] = row
        found.add(row.id)
      }
      for (const id of missing) if (!found.has(id)) cache[id] = null
    } catch (err) {
      console.error('[sourceRefs] resolve failed:', err)
      for (const id of missing) if (!(id in cache)) cache[id] = null
    }
  })()
  for (const id of missing) inflight.set(id, promise)
  await promise
  for (const id of missing) inflight.delete(id)
}
