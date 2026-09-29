/**
 * Evidence on a claim edge (docs/SCHEMA.md, "Source citations"):
 * `sourceRefs: string[]`, each `<source-id>[#<kind>:<entry>[,<entry>]*]`,
 * e.g. `urn-nbn-2010091308034#page:47..52`. What backs the claim itself —
 * a document, a page — as opposed to the citations of its note's text.
 *
 * Kept distinct from the single `sourceRef` on migrated claims, which says
 * where the claim came from (provenance), not what proves it.
 */

import { runCypher, type Neo4jEnv } from './neo4j.ts'

const FRAGMENT_RE = /^[a-z]+:[^#,]+(,[^#,]+)*$/

export const sourceRefId = (ref: string) => ref.split('#')[0]

/** Shape check: a list of refs, each with a non-empty id and a well-formed fragment. */
export function parseSourceRefs(v: unknown): { refs: string[] } | { error: string } {
  if (v === undefined || v === null) return { refs: [] }
  if (!Array.isArray(v)) return { error: 'sourceRefs må være en liste' }
  const refs: string[] = []
  for (const r of v) {
    if (typeof r !== 'string' || !r.trim()) return { error: `Ugyldig kilde: ${JSON.stringify(r)}` }
    const [id, fragment, extra] = r.trim().split('#')
    if (!id || extra !== undefined || (fragment !== undefined && !FRAGMENT_RE.test(fragment))) {
      return { error: `Ugyldig kildehenvisning: ${r} — bruk <kilde>#page:47 eller <kilde>#page:47..52` }
    }
    if (!refs.includes(r.trim())) refs.push(r.trim())
  }
  return { refs }
}

/** The ids among `refs` that don't name an existing Source — one query for a whole save. */
export async function unknownSources(env: Neo4jEnv, refs: string[]): Promise<string[]> {
  const ids = [...new Set(refs.map(sourceRefId))]
  if (!ids.length) return []
  const rows = await runCypher<{ id: string }>(env,
    `MATCH (s:Source) WHERE s.id IN $ids RETURN s.id AS id`, { ids })
  const found = new Set(rows.map(r => r.id))
  return ids.filter(id => !found.has(id))
}
