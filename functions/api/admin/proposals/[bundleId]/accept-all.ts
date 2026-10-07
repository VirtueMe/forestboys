/**
 * POST /api/admin/proposals/<bundleId>/accept-all
 *
 * Topologically sort the bundle's create-entity ops by their inter-entity
 * edge dependencies, then accept each pending entity in order via the
 * same logic as the per-entity endpoint. Outline (obsolete-outline) is
 * accepted last, after all non-Outline entities are decided — same as
 * the per-entity flow's auto-archive.
 *
 * Returns a summary: which entities were accepted / skipped / failed.
 *
 * Body: { message?: string } — applied to every accepted entity's
 * history log.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import {
  applyEntityOps,
  checkOpLinks,
  checkDescriptionDrift,
  checkPropDrift,
  ENTITY_ID_RE,
  indexRemove,
  manifestSetStatus,
  putIntentLock,
  type BundleManifest,
  type EntityPayload,
} from '~/api/admin/proposals/_apply.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { sourceIndexKey } from '~/_lib/bundle-origin.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

const BUNDLE_ID_RE = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

interface Body { message?: unknown }

interface AcceptResult {
  entityId: string
  status:   'accepted' | 'skipped' | 'failed'
  reason?:  string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = decodeURIComponent(String(params.bundleId))
  if (!BUNDLE_ID_RE.test(bundleId)) return json({ error: 'bundleId malformed' }, 400)

  const body = await request.json<Body>().catch((): Body => ({}))
  const message = typeof body.message === 'string' ? body.message : null

  const manifestObj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/manifest.json`)
  if (!manifestObj) return json({ error: 'Bundle not found' }, 404)
  const manifest = await manifestObj.json<BundleManifest>()

  // Load every payload up front so we can topo-sort by edges.
  const payloads = new Map<string, EntityPayload>()
  for (const ent of manifest.entities) {
    const obj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/entity/${ent.entityId}.json`)
    if (obj) payloads.set(ent.entityId, await obj.json<EntityPayload>())
  }

  const order = topoSort(manifest, payloads)
  const results: AcceptResult[] = []

  for (const entityId of order) {
    const ent = manifest.entities.find((e) => e.entityId === entityId)
    if (!ent) continue
    if (ent.status !== 'pending') {
      results.push({ entityId, status: 'skipped', reason: `already ${ent.status}` })
      continue
    }
    const payload = payloads.get(entityId)
    if (!payload) {
      results.push({ entityId, status: 'failed', reason: 'payload missing' })
      continue
    }

    // Field values changed since the proposal was made → leave it for a per-entity look.
    const driftedProps = [...await checkPropDrift(env, entityId, payload.ops), ...await checkDescriptionDrift(env, entityId, payload.ops)]
    if (driftedProps.length) {
      results.push({ entityId, status: 'failed', reason: `drift: ${driftedProps.map(d => d.prop).join(', ')}` })
      continue
    }

    const badLinks = await checkOpLinks(env, entityId, payload.ops)
    if (badLinks.length) {
      results.push({ entityId, status: 'failed', reason: `lenker som ikke fungerer: ${badLinks.map(l => `«${l.text}» → ${l.stored || '(tom)'}`).join(', ')}` })
      continue
    }

    const acceptedAt = new Date().toISOString()
    const intentKey  = `proposals/bundles/${bundleId}/accepted/${entityId.replace(':', '-')}-${acceptedAt}.json`
    const locked = await putIntentLock(env.PROPOSALS, intentKey,
      JSON.stringify({ entityId, bundleId, acceptedAt, message, ops: payload.ops }))
    if (!locked) {
      results.push({ entityId, status: 'failed', reason: 'concurrent accept in flight' })
      continue
    }

    try {
      const summary = await applyEntityOps(env, entityId, payload, bundleId, acceptedAt)
      await env.PROPOSALS.put(
        `history/${entityId}/${acceptedAt}-apply.json`,
        JSON.stringify({ kind: 'apply', entityId, bundleId, acceptedAt, message, summary }),
        { httpMetadata: { contentType: 'application/json' } },
      )
      await manifestSetStatus(env, bundleId, entityId, 'accepted')
      await indexRemove(env, `proposals/by-entity/${entityId}/index.json`, bundleId)

      // If this is the outline and it has obsolete-outline, archive it.
      const m = entityId.match(ENTITY_ID_RE)
      if (m && m[1] === 'Outline') {
        const archiveOp = payload.ops.find((o) => o.op === 'obsolete-outline')
        if (archiveOp && archiveOp.op === 'obsolete-outline') {
          await runCypher(env,
            `MATCH (o:Outline {slug: $slug})
             SET o.archivedAt = $at, o.archivedReason = $reason`,
            { slug: m[2], at: acceptedAt, reason: archiveOp.reason })
        }
      }

      results.push({ entityId, status: 'accepted' })
    } catch (e) {
      results.push({ entityId, status: 'failed', reason: (e as Error).message })
    }
  }

  // Final manifest read so the caller sees the post-state.
  const finalObj      = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/manifest.json`)
  const finalManifest = finalObj ? await finalObj.json<BundleManifest>() : manifest
  const remainingPending = finalManifest.entities.filter((e) => e.status === 'pending').length
  if (remainingPending === 0) {
    await indexRemove(env, sourceIndexKey(finalManifest), bundleId)
  }

  return json({ bundleId, results, remainingPending, bundleClosed: remainingPending === 0 })
}

/**
 * Kahn's algorithm: edge T → E means "T must be accepted before E"
 * (because E references T as an edge target). Outline entities sort
 * to the end so the obsolete-outline op fires after every non-Outline
 * sibling is accepted.
 */
function topoSort(manifest: BundleManifest, payloads: Map<string, EntityPayload>): string[] {
  const ids = manifest.entities.map((e) => e.entityId)
  const created = new Set(ids)
  const incoming = new Map<string, Set<string>>()  // E → {T1, T2}
  for (const id of ids) incoming.set(id, new Set())

  for (const id of ids) {
    const payload = payloads.get(id)
    if (!payload) continue
    const targets = new Set<string>()
    for (const op of payload.ops) {
      if (op.op === 'add-edge' || op.op === 'remove-edge') targets.add(op.to)
      else if (op.op === 'create-entity') for (const e of op.edges ?? []) targets.add(e.to)
    }
    for (const t of targets) {
      if (created.has(t) && t !== id) incoming.get(id)!.add(t)
    }
  }

  const isOutline = (id: string) => id.startsWith('Outline:')
  const out: string[] = []
  const ready: string[] = ids.filter((id) => incoming.get(id)!.size === 0 && !isOutline(id))
  while (ready.length) {
    ready.sort()
    const next = ready.shift()!
    out.push(next)
    for (const id of ids) {
      const inc = incoming.get(id)!
      if (inc.delete(next) && inc.size === 0 && !isOutline(id) && !out.includes(id) && !ready.includes(id)) {
        ready.push(id)
      }
    }
  }
  // Append any remaining (cycles) plus all Outlines last.
  for (const id of ids) {
    if (!out.includes(id) && !isOutline(id)) out.push(id)
  }
  for (const id of ids) {
    if (isOutline(id) && !out.includes(id)) out.push(id)
  }
  return out
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
