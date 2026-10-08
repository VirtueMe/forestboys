/**
 * GET /api/admin/proposals — list every bundle in R2.
 *
 * Lightweight summary per bundle: bundleId, source label, outlineId (outline
 * bundles), summary, status (derived, #185),
 * createdAt, entity counts, model. Sorted newest-first. The list
 * is bounded by R2's per-prefix scan; we list manifests under
 * proposals/bundles/<bundleId>/manifest.json and read each.
 *
 * Admin-session-gated.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { originKind, originLabel, type BundleOriginFields, type OriginKind } from '~/_lib/bundle-origin.ts'
import { bundleCounts, bundleStatus, type BundleStatus } from '../../../../src/utils/bundleStatus.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

interface BundleManifest extends BundleOriginFields {
  bundleId:    string
  summary:     string
  createdAt:   string
  model:       string
  entities:    { entityId: string; status: string }[]
  status?:     BundleStatus
  parentBundle?: string
}

interface BundleSummary {
  bundleId:           string
  /** "outline <slug>" / "Sanity <type>" */
  source:             string
  outlineId:          string | null
  summary:            string
  model:              string
  createdAt:          string
  /** Derived from the entities (src/utils/bundleStatus.ts), not the manifest's stored value. */
  status:             BundleStatus
  /** outline / package / sanity: where the bundle comes from, for those no model made. */
  originKind:         OriginKind
  pendingCount:       number
  acceptedCount:      number
  deniedCount:        number
  driftedCount:       number
  totalEntities:      number
  parentBundle:       string | null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  // List manifest objects directly. R2 list returns keys ordered
  // lexicographically; we'll sort by createdAt after.
  const manifestKeys: string[] = []
  let cursor: string | undefined
  do {
    const listing = await env.PROPOSALS.list({ prefix: 'proposals/bundles/', cursor, limit: 1000 })
    for (const obj of listing.objects) {
      if (obj.key.endsWith('/manifest.json')) manifestKeys.push(obj.key)
    }
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)

  const bundles: BundleSummary[] = []
  for (const key of manifestKeys) {
    try {
      const obj = await env.PROPOSALS.get(key)
      if (!obj) continue
      const m = await obj.json<BundleManifest>()
      const counts = bundleCounts(m.entities)
      bundles.push({
        bundleId:      m.bundleId,
        source:        originLabel(m),
        outlineId:     m.outlineId ?? null,
        summary:       m.summary,
        model:         m.model,
        createdAt:     m.createdAt,
        status:        bundleStatus(m),
        originKind:    originKind(m),
        pendingCount:  counts.pending,
        acceptedCount: counts.accepted,
        deniedCount:   counts.denied,
        driftedCount:  counts.drifted,
        totalEntities: m.entities.length,
        parentBundle:  m.parentBundle ?? null,
      })
    } catch { /* skip malformed manifest */ }
  }

  bundles.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return json({ bundles })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

