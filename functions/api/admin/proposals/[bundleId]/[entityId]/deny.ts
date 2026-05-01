/**
 * POST /api/admin/proposals/<bundleId>/<entityId>/deny
 *
 * Reject one entity within a bundle. Admin-session-gated. See
 * `docs/PROPOSALS.md` § "Deny (one entity within a bundle)" for the
 * full contract.
 *
 * Side-effect order (must match spec):
 *   1. Validate bundle + entity; status must be `pending`.
 *   2. Validate `reason` is non-trivial.
 *   3. Write `denied/<entityId>-<ts>.json` with `If-None-Match: *`.
 *   4. Append to `denied-corpus/<kind>.json`.
 *   5. Append history-log entry. (No Neo4j writes.)
 *   6. Patch manifest entity status to `denied`.
 *   7. Patch by-entity (and by-outline if bundle now closed) indices.
 *   8. If `reason.length >= 40`, fire-and-forget create a
 *      `bot-deny-analysis` GitHub issue. (DEFERRED — needs
 *      bot-deny-analysis workflow to land first.)
 *
 * Deferred (TODOs):
 *   - bot-deny-analysis issue creation.
 *   - SSE push (`proposal-denied` event).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import {
  ENTITY_ID_RE,
  indexRemove,
  manifestSetStatus,
  putIntentLock,
  type BundleManifest,
} from '~/api/admin/proposals/_apply.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

const BUNDLE_ID_RE  = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/
const REASON_MIN    = 8           // anything shorter is rejected as "trivial"
const REASON_BOT_GATE = 40        // analysis trigger threshold

interface DenyBody {
  reason?: unknown
}

interface DeniedCorpusEntry {
  bundleId:  string
  entityId:  string
  reason:    string
  deniedAt:  string
}

interface DeniedCorpus {
  entries: DeniedCorpusEntry[]
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = decodeURIComponent(String(params.bundleId))
  const entityId = decodeURIComponent(String(params.entityId))
  if (!BUNDLE_ID_RE.test(bundleId)) return json({ error: 'bundleId malformed' }, 400)
  const idMatch = entityId.match(ENTITY_ID_RE)
  if (!idMatch) return json({ error: 'entityId malformed' }, 400)
  const [, kind] = idMatch

  const body = await request.json<DenyBody>().catch(() => ({} as DenyBody))
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason || reason.length < REASON_MIN) {
    return json({ error: `reason required (min ${REASON_MIN} chars, non-whitespace)` }, 400)
  }

  // 1. Load manifest.
  const manifestObj = await env.PROPOSALS.get(`proposals/bundles/${bundleId}/manifest.json`)
  if (!manifestObj) return json({ error: 'Bundle not found' }, 404)
  const manifest = await manifestObj.json<BundleManifest>()

  const entityRef = manifest.entities.find((e) => e.entityId === entityId)
  if (!entityRef) return json({ error: 'Entity not in bundle' }, 404)
  if (entityRef.status !== 'pending') {
    return json({ kind: 'already-decided', currentStatus: entityRef.status }, 409)
  }

  const deniedAt   = new Date().toISOString()
  const archiveKey = `proposals/bundles/${bundleId}/denied/${entityId.replace(':', '-')}-${deniedAt}.json`
  const archiveBody = JSON.stringify({ entityId, bundleId, deniedAt, reason })
  const locked = await putIntentLock(env.PROPOSALS, archiveKey, archiveBody)
  if (!locked) return json({ error: 'Concurrent deny in flight' }, 409)

  // 4. Append to denied-corpus.
  await appendDeniedCorpus(env.PROPOSALS, kind, { bundleId, entityId, reason, deniedAt })

  // 5. History.
  await env.PROPOSALS.put(
    `history/${entityId}/${deniedAt}-deny.json`,
    JSON.stringify({ kind: 'deny', entityId, bundleId, deniedAt, reason }),
    { httpMetadata: { contentType: 'application/json' } },
  )

  // 6. Manifest patch.
  const updatedManifest = await manifestSetStatus(env, bundleId, entityId, 'denied')

  // 7. Index pruning.
  await indexRemove(env, `proposals/by-entity/${entityId}/index.json`, bundleId)

  const remainingPending = updatedManifest.entities.filter((e) => e.status === 'pending').length
  const bundleClosed     = remainingPending === 0
  if (bundleClosed) {
    await indexRemove(env, `proposals/by-outline/${updatedManifest.outlineId}/index.json`, bundleId)
  }

  // 8. TODO: bot-deny-analysis issue creation when reason.length >= REASON_BOT_GATE.
  //    Requires the bot-deny-analysis workflow + denial-analysis prompt to
  //    land. Currently a no-op pending fire-and-forget hook.
  void REASON_BOT_GATE

  return json({
    bundleId,
    entityId,
    status:           'denied',
    remainingPending,
    bundleClosed,
  })
}

async function appendDeniedCorpus(
  bucket: R2Bucket,
  kind:   string,
  entry:  DeniedCorpusEntry,
): Promise<void> {
  const key = `denied-corpus/${kind}.json`
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await bucket.get(key)
    let corpus: DeniedCorpus
    let etag: string | undefined
    if (existing) {
      etag   = existing.httpEtag
      corpus = await existing.json<DeniedCorpus>()
    } else {
      corpus = { entries: [] }
    }
    corpus.entries.push(entry)
    const opts: R2PutOptions = {
      httpMetadata: { contentType: 'application/json' },
      onlyIf:       etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
    }
    const result = await bucket.put(key, JSON.stringify(corpus), opts)
    if (result) return
  }
  throw new Error(`appendDeniedCorpus: conditional write failed after 3 attempts`)
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
