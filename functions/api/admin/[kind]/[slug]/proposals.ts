/**
 * GET /api/admin/<kind>/<slug>/proposals             — open bundles touching this entity
 * GET /api/admin/<kind>/<slug>/proposals?count=true  — just the marker-badge count
 *
 * Reads `proposals/by-entity/<entityId>/index.json`, fetches each
 * referenced bundle's manifest + this entity's payload, returns the list.
 *
 * Bundle status filter: only bundles where this entity's status is
 * `pending` are returned. Once Jan accepts/denies the entity, it falls
 * out of the list (the manifest patch flips the per-entity status).
 *
 * Admin-session-gated.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

const ENTITY_KINDS = new Set([
  'Person', 'Unit', 'Station', 'Transport',
  'Operation', 'Incident', 'Location', 'Outline', 'Organization',
])
const SLUG_RE = /^[a-z0-9-]+$/

interface BundleEntityRef {
  entityId:  string
  status:    'pending' | 'accepted' | 'denied' | 'drifted'
  opSummary: string[]
}

interface BundleManifest {
  bundleId:   string
  outlineId:  string
  outlineRev: string
  summary:    string
  createdAt:  string
  model:      string
  promptHash: string
  entities:   BundleEntityRef[]
}

interface IndexFile {
  bundleIds: string[]
}

interface OpenBundleEntry {
  bundleId:   string
  outlineId:  string
  summary:    string
  createdAt:  string
  status:     'pending'
  opSummary:  string[]
  payloadKey: string  // R2 key of this entity's payload, for lazy fetch by the diff panel
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const kind = String(params.kind)
  const slug = String(params.slug)
  if (!ENTITY_KINDS.has(kind)) return json({ error: `Unknown kind: ${kind}` }, 400)
  if (!SLUG_RE.test(slug))     return json({ error: 'slug must match /^[a-z0-9-]+$/' }, 400)

  const entityId = `${kind}:${slug}`
  const url      = new URL(request.url)
  const countOnly = url.searchParams.get('count') === 'true'

  try {
    const indexObj = await env.PROPOSALS.get(`proposals/by-entity/${entityId}/index.json`)
    if (!indexObj) {
      return countOnly
        ? json({ pendingCount: 0 })
        : json({ entityId, openBundles: [] })
    }

    const index = await indexObj.json<IndexFile>()

    // For each referenced bundle, load its manifest and check whether this
    // entity's status is still pending. Drop drifted/accepted/denied —
    // those have either already happened or are recoverable elsewhere.
    const bundleEntries = await Promise.all(
      index.bundleIds.map((bundleId) => loadOpenEntry(env, bundleId, entityId)),
    )
    const open = bundleEntries.filter((b): b is OpenBundleEntry => b !== null)

    if (countOnly) return json({ pendingCount: open.length })

    return json({ entityId, openBundles: open })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

async function loadOpenEntry(env: Env, bundleId: string, entityId: string): Promise<OpenBundleEntry | null> {
  const manifestObj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/manifest.json`)
  if (!manifestObj) return null

  const manifest = await manifestObj.json<BundleManifest>()
  const ref = manifest.entities.find((e) => e.entityId === entityId)
  if (!ref || ref.status !== 'pending') return null

  return {
    bundleId,
    outlineId:  manifest.outlineId,
    summary:    manifest.summary,
    createdAt:  manifest.createdAt,
    status:     'pending',
    opSummary:  ref.opSummary,
    payloadKey: `proposals/bundles/${bundleId}/entity/${entityId}.json`,
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
