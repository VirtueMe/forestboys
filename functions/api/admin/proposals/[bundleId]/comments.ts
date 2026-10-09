/**
 * Comments on a bundle (#186): notes between editors, about the bundle as a whole or about one entity of it.
 *
 *   GET  /api/admin/proposals/<bundleId>/comments?type=bundle
 *   GET  /api/admin/proposals/<bundleId>/comments?type=entity&entityId=<Kind:slug>   one thread, oldest first
 *   POST /api/admin/proposals/<bundleId>/comments   { type, entityId?, text }       → 201 { comment }
 *
 * Admin-session-gated. One object per comment (functions/_lib/bundle-comments.ts); the event log gets a pointer and no text.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { actorOf, recordEvent, withCurrentNames } from '~/_lib/bundle-events.ts'
import { refreshRow } from '~/_lib/bundle-index.ts'
import { listCommentRefs, readThread, writeComment } from '~/_lib/bundle-comments.ts'
import { validateComment } from '../../../../../src/utils/bundleComments.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
  milorg_users?:  D1Database
}

const BUNDLE_ID_RE = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = decodeURIComponent(String(params.bundleId))
  if (!BUNDLE_ID_RE.test(bundleId)) return json({ error: 'bundleId malformed' }, 400)

  const q = new URL(request.url).searchParams
  const type = q.get('type')
  const entityId = q.get('entityId')
  if (type !== 'bundle' && !(type === 'entity' && entityId)) return json({ error: '`type=bundle`, or `type=entity` with `entityId`' }, 400)

  try {
    const refs     = await listCommentRefs(env.PROPOSALS, bundleId)
    const comments = await readThread(env.PROPOSALS, bundleId, refs, type === 'bundle' ? { type: 'bundle' } : { type: 'entity', entityId: entityId! })
    return json({ comments: await withCurrentNames(env.milorg_users, comments) })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = decodeURIComponent(String(params.bundleId))
  if (!BUNDLE_ID_RE.test(bundleId)) return json({ error: 'bundleId malformed' }, 400)

  try {
    const manifestObj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/manifest.json`)
    if (!manifestObj) return json({ error: 'Bundle not found' }, 404)
    const manifest = await manifestObj.json<{ entities: { entityId: string }[] }>()

    const input = validateComment(await request.json().catch(() => null), manifest.entities.map(e => e.entityId))
    if (typeof input === 'string') return json({ error: input }, 400)

    const actor   = actorOf(guard)
    const comment = await writeComment(env.PROPOSALS, bundleId, actor, input)
    await recordEvent(env.PROPOSALS, bundleId, actor, {
      kind: 'commented', commentId: comment.id, scope: comment.type, ...(comment.entityId ? { entityId: comment.entityId } : {}),
    })
    await refreshRow(env.PROPOSALS, bundleId)
    return json({ comment }, 201)
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
