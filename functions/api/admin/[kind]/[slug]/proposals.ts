/**
 * GET /api/admin/<kind>/<slug>/proposals             — open bundles touching this entity
 * GET /api/admin/<kind>/<slug>/proposals?count=true  — just the marker-badge count
 *
 * Lists `proposals/by-entity/<entityId>/` with the custom metadata (#273): one record per bundle that touches this entity,
 * in any state. The count is the `pending` records, no body read. The list loads the manifest of each pending bundle, and
 * returns the other records as `otherBundles` (status, date, what they change); two pending bundles that change the same
 * thing are marked on both with `conflictsWith`.
 *
 * `openBundles` holds only bundles where this entity is `pending`. Once Jan accepts/denies the entity, it moves to `otherBundles`.
 *
 * Admin-session-gated.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { originLabel, type BundleOriginFields } from '~/_lib/bundle-origin.ts'
import { listRecords } from '~/_lib/entity-records.ts'
import { conflicts, createdAtOf, sharedChanges, type EntityRecord } from '../../../../../src/utils/entityRecord.ts'

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

interface BundleManifest extends BundleOriginFields {
  bundleId:   string
  summary:    string
  createdAt:  string
  model:      string
  promptHash: string
  entities:   BundleEntityRef[]
}

interface OpenBundleEntry {
  bundleId:   string
  /** "outline <slug>" / "Sanity <type>" */
  source:     string
  outlineId:  string | null
  summary:    string
  createdAt:  string
  status:     'pending'
  opSummary:  string[]
  payloadKey: string  // R2 key of this entity's payload, for lazy fetch by the diff panel
  /** Other pending bundles that change the same thing in this entity, and what they share. */
  conflictsWith: { bundleId: string; shared: string[] }[]
}

/** A bundle that touches this entity and is not waiting on it: decided, set aside or archived. */
interface OtherBundleEntry {
  bundleId:  string
  createdAt: string
  status:    EntityRecord['status']
  props:     string[]
  blocks:    string[]
  edges:     string[]
  ops:       string[]
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
    const generationPending = kind === 'Outline'
      ? await checkGenerationPending(env, slug)
      : false

    const records = await listRecords(env.PROPOSALS, entityId)
    const pending = records.filter((r) => r.status === 'pending')

    if (countOnly) return json({ pendingCount: pending.length, generationPending })

    // The manifest has the last word on whether this entity still waits in the bundle.
    const bundleEntries = await Promise.all(
      pending.map((r) => loadOpenEntry(env, r.bundleId, entityId, pending)),
    )
    const open = bundleEntries.filter((b): b is OpenBundleEntry => b !== null)
    const openIds = new Set(open.map((b) => b.bundleId))
    const otherBundles = records.filter((r) => !openIds.has(r.bundleId)).map(otherEntry)

    return json({ entityId, openBundles: open, otherBundles, generationPending })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

async function checkGenerationPending(env: Env, outlineSlug: string): Promise<boolean> {
  const obj = await env.PROPOSALS.get(`proposals/pending-generations/${outlineSlug}.json`)
  if (!obj) return false
  try {
    const data = await obj.json<{ expiresAt: string }>()
    if (Date.parse(data.expiresAt) < Date.now()) {
      await env.PROPOSALS.delete(`proposals/pending-generations/${outlineSlug}.json`)
      return false
    }
    return true
  } catch {
    return false
  }
}

function otherEntry(r: EntityRecord): OtherBundleEntry {
  return { bundleId: r.bundleId, createdAt: createdAtOf(r.bundleId), status: r.status, props: r.props, blocks: r.blocks, edges: r.edges, ops: r.ops }
}

async function loadOpenEntry(env: Env, bundleId: string, entityId: string, pending: EntityRecord[]): Promise<OpenBundleEntry | null> {
  const manifestObj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/manifest.json`)
  if (!manifestObj) return null

  const manifest = await manifestObj.json<BundleManifest>()
  const ref = manifest.entities.find((e) => e.entityId === entityId)
  if (!ref || ref.status !== 'pending') return null
  const mine = pending.find((r) => r.bundleId === bundleId)!

  return {
    bundleId,
    source:     originLabel(manifest),
    outlineId:  manifest.outlineId ?? null,
    summary:    manifest.summary,
    createdAt:  manifest.createdAt,
    status:     'pending',
    opSummary:  ref.opSummary,
    payloadKey: `proposals/bundles/${bundleId}/entity/${entityId}.json`,
    conflictsWith: pending
      .filter((other) => conflicts(mine, other))
      .map((other) => ({ bundleId: other.bundleId, shared: sharedChanges(mine, other) })),
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
