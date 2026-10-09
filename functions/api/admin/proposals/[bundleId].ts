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
import { bundleChannel, type BundleOriginFields, type DerivedFrom } from '~/_lib/bundle-origin.ts'
import { actorOf, listEvents, withCurrentNames } from '~/_lib/bundle-events.ts'
import { ArchiveError, archiveBundle } from '~/_lib/bundle-archive.ts'
import { validateReason } from '../../../../src/utils/bundleArchive.ts'
import { listCommentRefs } from '~/_lib/bundle-comments.ts'
import { countComments } from '../../../../src/utils/bundleComments.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
  BUNDLE_EVENTS?: DurableObjectNamespace
  milorg_users?:  D1Database
}

const BUNDLE_ID_RE = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

interface BundleManifest extends BundleOriginFields {
  bundleId:   string
  summary:    string
  createdAt:  string
  model:      string
  promptHash: string
  entities:   { entityId: string; status: string; opSummary: string[] }[]
}

interface EntityPayload {
  entityId:    string
  ops:         unknown[]
  derivedFrom: DerivedFrom
  source:      string
  generatedAt: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  // CF Pages delivers route params URL-encoded; the colons in bundleId
  // would fail BUNDLE_ID_RE without decoding.
  const bundleId = decodeURIComponent(String(params.bundleId))
  if (!BUNDLE_ID_RE.test(bundleId)) {
    return json({ error: 'bundleId must match `bundle:<channel>:<isoTimestamp>`' }, 400)
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
      events:   await withCurrentNames(env.milorg_users, await listEvents(env.PROPOSALS, bundleId)),
      // One listing with the metadata: how many comments each thread has, with no comment read.
      commentCounts: countComments(await listCommentRefs(env.PROPOSALS, bundleId)),
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

/**
 * DELETE /api/admin/proposals/<bundleId> — «Slett» archives the bundle (#188).
 *
 * Body: `{ reason }`, written down so the next editor knows why. The whole bundle (manifest, payloads, the accepted / denied
 * records, the comments and the log) is kept as one object under proposals/archive/, with who and when, and leaves the lists and
 * the open-bundle indexes as a deleted one always did. It can be looked at in the archive and, if nothing in it was accepted,
 * restored. Admin-session-gated.
 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = decodeURIComponent(String(params.bundleId))
  if (!BUNDLE_ID_RE.test(bundleId)) {
    return json({ error: 'bundleId must match `bundle:<channel>:<isoTimestamp>`' }, 400)
  }
  const reason = validateReason(await request.json().catch(() => null))
  if (typeof reason !== 'string') return json(reason, 400)

  try {
    const manifestObj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/manifest.json`)
    if (!manifestObj) return json({ error: 'Bundle not found' }, 404)
    const manifest = await manifestObj.json<BundleManifest>()

    const summary = await archiveBundle(env.PROPOSALS, bundleId, actorOf(guard), reason)

    if (env.BUNDLE_EVENTS) {
      try {
        const id = env.BUNDLE_EVENTS.idFromName(bundleChannel(manifest))
        await env.BUNDLE_EVENTS.get(id).fetch('https://bundle-events/broadcast', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ kind: 'bundle-deleted', bundleId }),
        })
      } catch (e) {
        console.error('broadcast failed:', (e as Error).message)
      }
    }

    return json({ ok: true, archived: summary })
  } catch (e) {
    if (e instanceof ArchiveError) return json({ error: e.message }, e.status)
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
