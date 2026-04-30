/**
 * POST /api/admin/proposals/<bundleId>/<entityId>/accept
 *
 * Apply one entity's ops within a bundle. Admin-session-gated. See
 * `docs/PROPOSALS.md` § "Accept (one entity within a bundle)" for the
 * full contract.
 *
 * Side-effect order (must match spec):
 *   1. Validate bundle + entity exist; status must be `pending`.
 *   2. Drift check on every modify-block op (live sha vs expectedSha).
 *   3. Intent lock — write `accepted/<entityId>-<ts>.json` with
 *      `If-None-Match: *`. Fails fast on double-accept.
 *   4. Apply ops to Neo4j (one transaction; modify-block read-then-write
 *      runs separately — see `_apply.ts` v1 limitation note).
 *   5. Append history log entry.
 *   6. Patch manifest entity status to `accepted`.
 *   7. Patch by-entity / by-outline indices.
 *   8. Auto-archive outline if every other entity in the bundle is
 *      non-pending and the bundle includes an `obsolete-outline` op.
 *
 * Deferred (TODOs):
 *   - SSE push (`proposal-accepted` event).
 *   - Edge-target resolution against pending-in-this-bundle entities
 *     (currently relies on Jan accepting in dependency order).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import {
  applyEntityOps,
  checkDrift,
  ENTITY_ID_RE,
  indexRemove,
  manifestSetStatus,
  putIntentLock,
  type BundleManifest,
  type EntityPayload,
} from '~/api/admin/proposals/_apply.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { runCypher } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

const BUNDLE_ID_RE = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

interface AcceptBody {
  message?:      unknown
  expectedShas?: unknown
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = String(params.bundleId)
  const entityId = String(params.entityId)
  if (!BUNDLE_ID_RE.test(bundleId)) return json({ error: 'bundleId malformed' }, 400)
  if (!ENTITY_ID_RE.test(entityId)) return json({ error: 'entityId malformed' }, 400)

  const body = await request.json<AcceptBody>().catch(() => ({} as AcceptBody))
  const message = typeof body.message === 'string' ? body.message : null
  const expectedShas = isShaMap(body.expectedShas) ? body.expectedShas : {}

  // 1. Load manifest + payload.
  const manifestObj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/manifest.json`)
  if (!manifestObj) return json({ error: 'Bundle not found' }, 404)
  const manifest = await manifestObj.json<BundleManifest>()

  const entityRef = manifest.entities.find((e) => e.entityId === entityId)
  if (!entityRef) return json({ error: 'Entity not in bundle' }, 404)
  if (entityRef.status !== 'pending') {
    return json({ kind: 'already-decided', currentStatus: entityRef.status }, 409)
  }

  const payloadObj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/entity/${entityId}.json`)
  if (!payloadObj) return json({ error: 'Payload not found' }, 404)
  const payload = await payloadObj.json<EntityPayload>()

  // 2. Drift check.
  const drifted = await checkDrift(env, entityId, payload.ops, expectedShas)
  if (drifted.length) {
    return json({ kind: 'drift', driftedBlocks: drifted }, 409)
  }

  // 3. Intent lock.
  const acceptedAt = new Date().toISOString()
  const intentKey  = `proposals/bundles/${bundleId}/accepted/${entityId.replace(':', '-')}-${acceptedAt}.json`
  const intentBody = JSON.stringify({ entityId, bundleId, acceptedAt, message, ops: payload.ops })
  const locked = await putIntentLock(env.PROPOSALS, intentKey, intentBody)
  if (!locked) return json({ error: 'Concurrent accept in flight' }, 409)

  // 4. Apply.
  let summary
  try {
    summary = await applyEntityOps(env, entityId, payload, bundleId, acceptedAt)
  } catch (e) {
    // Apply failed — leave the intent-lock for the janitor to clean up
    // (see PROPOSALS.md § "Failure recovery"). Re-trying the accept will
    // hit a 409 on the intent-lock and surface this state.
    return json({ error: `apply failed: ${(e as Error).message}` }, 502)
  }

  // 5. History log.
  await env.PROPOSALS.put(
    `history/${entityId}/${acceptedAt}-apply.json`,
    JSON.stringify({
      kind:        'apply',
      entityId,
      bundleId,
      acceptedAt,
      message,
      summary,
    }),
    { httpMetadata: { contentType: 'application/json' } },
  )

  // 6. Manifest patch.
  const updatedManifest = await manifestSetStatus(env, bundleId, entityId, 'accepted')

  // 7. Index pruning.
  await indexRemove(env, `proposals/by-entity/${entityId}/index.json`, bundleId)

  const remainingPending = updatedManifest.entities.filter((e) => e.status === 'pending').length
  const bundleClosed     = remainingPending === 0
  if (bundleClosed) {
    await indexRemove(env, `proposals/by-outline/${updatedManifest.outlineId}/index.json`, bundleId)
  }

  // 8. Auto-archive outline if every non-Outline entity is now non-pending
  //    and the bundle carries an obsolete-outline op for this outline.
  let outlineArchived = false
  const outlineEntityId = `Outline:${updatedManifest.outlineId}`
  const outlineEnt      = updatedManifest.entities.find((e) => e.entityId === outlineEntityId)
  const nonOutlineAllDecided = updatedManifest.entities
    .filter((e) => e.entityId !== outlineEntityId)
    .every((e) => e.status !== 'pending')
  if (outlineEnt && outlineEnt.status === 'pending' && nonOutlineAllDecided) {
    const outlinePayloadObj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/entity/${outlineEntityId}.json`)
    if (outlinePayloadObj) {
      const outlinePayload = await outlinePayloadObj.json<EntityPayload>()
      const archiveOp = outlinePayload.ops.find((o) => o.op === 'obsolete-outline')
      if (archiveOp && archiveOp.op === 'obsolete-outline') {
        await runCypher(
          env,
          `MATCH (o:Outline {slug: $slug})
           SET o.archivedAt = $at, o.archivedReason = $reason`,
          { slug: updatedManifest.outlineId, at: acceptedAt, reason: archiveOp.reason },
        )
        await manifestSetStatus(env, bundleId, outlineEntityId, 'accepted')
        await indexRemove(env, `proposals/by-entity/${outlineEntityId}/index.json`, bundleId)
        outlineArchived = true
      }
    }
  }

  // TODO: SSE push (proposal-accepted) once the Durable Object is in place.

  return json({
    bundleId,
    entityId,
    status:           'accepted',
    remainingPending,
    bundleClosed:     remainingPending === 0,
    outlineArchived,
  })
}

function isShaMap(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object') return false
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== 'string') return false
  }
  return true
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
