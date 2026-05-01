/**
 * GET    /api/admin/proposals/pending/<outlineId> — is a generation pending?
 * DELETE /api/admin/proposals/pending/<outlineId> — clear a stuck marker.
 *
 * Admin-session-gated. Used when a bot run fails out-of-band (workflow
 * crash, runner offline, claude error) and the 15-minute TTL hasn't
 * expired yet. Clearing here removes the spinner + re-enables the
 * "Be om forslag" button so Jan can retry.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

const SLUG_RE = /^[a-z0-9-]+$/

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  const outlineId = String(params.outlineId)
  if (!SLUG_RE.test(outlineId)) return json({ error: 'outlineId malformed' }, 400)

  const obj = await env.PROPOSALS.get(`proposals/pending-generations/${outlineId}.json`)
  if (!obj) return json({ pending: false })
  const data = await obj.json<{ requestedAt: string; expiresAt: string }>()
  return json({ pending: true, ...data })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  const outlineId = String(params.outlineId)
  if (!SLUG_RE.test(outlineId)) return json({ error: 'outlineId malformed' }, 400)

  await env.PROPOSALS.delete(`proposals/pending-generations/${outlineId}.json`)
  return json({ ok: true })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
