/**
 * GET /api/admin/proposals/<bundleId> — full bundle (manifest + every
 * per-entity payload).
 *
 * Used by:
 *   - /proposals/<bundleId> review page (lists all entities + status)
 *   - useProposalEntityData composable (reads the per-entity payload for
 *     the kind it's previewing)
 *
 * Admin-session-gated. Returns 404 if the bundle's manifest is missing.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

const BUNDLE_ID_RE = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

interface BundleManifest {
  bundleId:   string
  outlineId:  string
  outlineRev: string
  summary:    string
  createdAt:  string
  model:      string
  promptHash: string
  entities:   { entityId: string; status: string; opSummary: string[] }[]
}

interface EntityPayload {
  entityId:    string
  ops:         unknown[]
  derivedFrom: { outlineId: string; sectionPath?: string; outlineRev: string }
  source:      string
  generatedAt: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = String(params.bundleId)
  if (!BUNDLE_ID_RE.test(bundleId)) {
    return json({ error: 'bundleId must match `bundle:<outlineId>:<isoTimestamp>`' }, 400)
  }

  try {
    const manifestObj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/manifest.json`)
    if (!manifestObj) return json({ error: 'Bundle not found' }, 404)
    const manifest = await manifestObj.json<BundleManifest>()

    const payloads = await Promise.all(
      manifest.entities.map(async (ref) => {
        const obj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/entity/${ref.entityId}.json`)
        if (!obj) return null  // missing payload — should not happen, but tolerate
        return await obj.json<EntityPayload>()
      }),
    )

    return json({
      manifest,
      payloads: payloads.filter((p): p is EntityPayload => p !== null),
    })
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
