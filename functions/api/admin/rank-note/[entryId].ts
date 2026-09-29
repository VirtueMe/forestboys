/**
 * PATCH /api/admin/rank-note/:entryId
 *
 * Replace-all the note sections for one rank history entry (one HELD_RANK edge):
 *
 *   (Person)-[:HAS_RANK_NOTE]->(Description {rankEntryId})-[:ABOUT_RANK]->(Rank)
 *
 * Keyed by the edge's `id`, not the rank, so holding the same rank twice
 * keeps separate notes (why it was awarded, acting circumstances). See functions/_lib/edge-note.ts.
 *
 * Body: { sections: [{ order, content, citations?, sourcedFromId? }, ...] }
 * Empty sections clears the note.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { RANK_NOTE, parseSections, writeEdgeNote } from '~/_lib/edge-note.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const sections = parseSections(await request.json().catch(() => null))
  if (typeof sections === 'string') return json({ error: sections }, 400)

  try {
    const out = await writeEdgeNote(env, RANK_NOTE, String(params.entryId), sections)
    return 'error' in out ? json({ error: out.error }, out.status) : json(out)
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
