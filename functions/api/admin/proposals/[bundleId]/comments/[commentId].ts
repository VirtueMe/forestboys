/**
 * DELETE /api/admin/proposals/<bundleId>/comments/<commentId> — remove a comment. Any admin may: these are notes between
 * editors, and housekeeping includes tidying them. The log keeps a pointer («removed a comment»), never the text.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { actorOf, recordEvent } from '~/_lib/bundle-events.ts'
import { refreshRow } from '~/_lib/bundle-index.ts'
import { commentKey } from '~/_lib/bundle-comments.ts'
import { COMMENT_ID_RE, type BundleComment } from '../../../../../../src/utils/bundleComments.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

const BUNDLE_ID_RE = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId  = decodeURIComponent(String(params.bundleId))
  const commentId = decodeURIComponent(String(params.commentId))
  if (!BUNDLE_ID_RE.test(bundleId))   return json({ error: 'bundleId malformed' }, 400)
  if (!COMMENT_ID_RE.test(commentId)) return json({ error: 'commentId malformed' }, 400)

  try {
    const key = commentKey(bundleId, commentId)
    const obj = await env.PROPOSALS.get(key)
    if (!obj) return json({ error: 'Comment not found' }, 404)
    const comment = await obj.json<BundleComment>()
    await env.PROPOSALS.delete(key)
    await recordEvent(env.PROPOSALS, bundleId, actorOf(guard), {
      kind: 'comment-removed', commentId, scope: comment.type, ...(comment.entityId ? { entityId: comment.entityId } : {}),
    })
    await refreshRow(env.PROPOSALS, bundleId)
    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
