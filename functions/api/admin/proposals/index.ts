/**
 * GET /api/admin/proposals — the bundles in R2, filtered, sorted and paged (#184).
 *
 *   ?status=pending|blocked|closed|all   (default pending: the review queue)   &origin=outline|package|sanity
 *   &kind=Unit   &q=text   &commented=1   &sort=newest|oldest|pending|touched   &limit=10|20|40   &offset=n
 *
 * Answers `{ bundles, total, facets }`: the page of rows, how many match before paging, and the counts by status and the kinds
 * there are for the tabs and menus. The rows come from the index (functions/_lib/bundle-index.ts): one listing, no manifest
 * read. An empty index is built from the bundles once. Admin-session-gated.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { listRows, rebuildIndex } from '~/_lib/bundle-index.ts'
import { parseQuery, queryRows } from '../../../../src/utils/bundleIndex.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  try {
    let rows = await listRows(env.PROPOSALS)
    if (!rows.length) {
      // No index yet (the bundles are from before it): build it from them once.
      await rebuildIndex(env.PROPOSALS)
      rows = await listRows(env.PROPOSALS)
    }
    return json(queryRows(rows, parseQuery(new URL(request.url).searchParams)))
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
