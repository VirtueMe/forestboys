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
import { bundleChannel, sourceIndexKey, type BundleOriginFields, type DerivedFrom } from '~/_lib/bundle-origin.ts'
import { actorOf, deletedKey, listEvents, withCurrentNames, type DeletedRecord } from '~/_lib/bundle-events.ts'

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
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

/**
 * DELETE /api/admin/proposals/<bundleId> — remove a bundle entirely.
 *
 * Drops manifest + every per-entity payload, then prunes the bundleId
 * from the per-entity and source indices. Intent locks under the
 * bundle are also removed. Used for cleanup when a bundle is stale or
 * the bot's output was bad enough that Jan wants it gone instead of
 * denying entity-by-entity.
 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  const actor = actorOf(guard)
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = decodeURIComponent(String(params.bundleId))
  if (!BUNDLE_ID_RE.test(bundleId)) {
    return json({ error: 'bundleId must match `bundle:<channel>:<isoTimestamp>`' }, 400)
  }

  try {
    const manifestKey = `proposals/bundles/${bundleId}/manifest.json`
    const manifestObj = await env.PROPOSALS.get(manifestKey)
    if (!manifestObj) return json({ error: 'Bundle not found' }, 404)
    const manifest = await manifestObj.json<BundleManifest>()

    // The bundle's own events go with it. What is kept until the archive (#188) keeps it all: who, when, what it held.
    const record: DeletedRecord = {
      bundleId, summary: manifest.summary, deletedAt: new Date().toISOString(), actor,
      entities: manifest.entities.map((e) => ({ entityId: e.entityId, status: e.status })),
    }
    await env.PROPOSALS.put(deletedKey(bundleId), JSON.stringify(record), { httpMetadata: { contentType: 'application/json' } })

    // Prune per-entity indices first so the bundle stops appearing in
    // open-bundle lists even if the rest of the cleanup races.
    for (const ent of manifest.entities) {
      await indexRemove(env.PROPOSALS, `proposals/by-entity/${ent.entityId}/index.json`, bundleId)
    }
    await indexRemove(env.PROPOSALS, sourceIndexKey(manifest), bundleId)

    // Delete payloads + manifest + intent locks under the bundle prefix.
    const prefix = `proposals/bundles/${bundleId}/`
    let cursor: string | undefined
    const keys: string[] = []
    do {
      const listing = await env.PROPOSALS.list({ prefix, cursor })
      for (const obj of listing.objects) keys.push(obj.key)
      cursor = listing.truncated ? listing.cursor : undefined
    } while (cursor)
    if (keys.length) await env.PROPOSALS.delete(keys)

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

    return json({ ok: true, deletedKeys: keys.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

async function indexRemove(bucket: R2Bucket, key: string, bundleId: string): Promise<void> {
  const existing = await bucket.get(key)
  if (!existing) return
  const etag    = existing.httpEtag.replace(/^"(.*)"$/, '$1')
  const index   = await existing.json<{ bundleIds: string[] }>()
  const next    = { bundleIds: index.bundleIds.filter((b) => b !== bundleId) }
  if (next.bundleIds.length === index.bundleIds.length) return
  await bucket.put(key, JSON.stringify(next), {
    httpMetadata: { contentType: 'application/json' },
    onlyIf:       { etagMatches: etag },
  })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
