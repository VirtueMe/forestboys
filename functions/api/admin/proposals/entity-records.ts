/**
 * POST /api/admin/proposals/entity-records — write the entity records (#273) of the bundles from before them, from the
 * manifests and payloads. A dry run unless the body says `"write": true`. A Worker has a limit on subrequests, so it works
 * through the bundles up to a budget and answers with `next`: send it again with `"cursor": <next>` until `next` is null.
 * `"dropIndexes": true` instead deletes the old `proposals/by-entity/<entityId>/index.json` files, once the readers have
 * switched. Admin-session-gated. docs/PROPOSALS.md, «Entity records».
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { backfillEntityRecords, dropOldIndexes } from '~/_lib/entity-records.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

/** Under the limit of 1,000 subrequests of one invocation, with room for the guard. */
const BUDGET = 900

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const body: { write?: unknown; cursor?: unknown; dropIndexes?: unknown } = await request.json<Record<string, unknown>>().catch(() => ({}))
  const write = body.write === true
  try {
    if (body.dropIndexes === true) return json({ ok: true, write, ...await dropOldIndexes(env.PROPOSALS, { write }) })
    const cursor = typeof body.cursor === 'string' ? body.cursor : null
    return json({ ok: true, write, ...await backfillEntityRecords(env.PROPOSALS, { write, budget: BUDGET, cursor }) })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
