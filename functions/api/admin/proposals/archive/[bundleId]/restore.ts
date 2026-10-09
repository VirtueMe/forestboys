/**
 * POST /api/admin/proposals/archive/<bundleId>/restore — put an archived bundle back (#188).
 *
 * Body: `{ reason? }`, optional: why it comes back. It is written as a comment on the bundle and in the log.
 *
 * Only a bundle nothing of which was accepted: an accepted entity's ops are in the graph, so the bundle stays an archived
 * record. 409 if a bundle with the same id is there already. Admin-session-gated.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { actorOf } from '~/_lib/bundle-events.ts'
import { ArchiveError, restoreBundle } from '~/_lib/bundle-archive.ts'
import { validateOptionalReason } from '../../../../../../src/utils/bundleArchive.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

const BUNDLE_ID_RE = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = decodeURIComponent(String(params.bundleId))
  if (!BUNDLE_ID_RE.test(bundleId)) return json({ error: 'bundleId malformed' }, 400)

  const reason = validateOptionalReason(await request.json().catch(() => null))
  if (reason !== null && typeof reason !== 'string') return json(reason, 400)

  try {
    await restoreBundle(env.PROPOSALS, bundleId, actorOf(guard), reason)
    return json({ ok: true, bundleId })
  } catch (e) {
    if (e instanceof ArchiveError) return json({ error: e.message }, e.status)
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
