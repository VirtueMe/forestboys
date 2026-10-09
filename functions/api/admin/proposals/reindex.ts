/**
 * POST /api/admin/proposals/reindex — rebuild the list's index from the bundles (#184). For the bundles from before the index,
 * and for a row that went stale. Reads one manifest per bundle: an explicit act, not every load. Admin-session-gated.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { rebuildIndex } from '~/_lib/bundle-index.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)
  try {
    return json({ ok: true, ...await rebuildIndex(env.PROPOSALS) })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
