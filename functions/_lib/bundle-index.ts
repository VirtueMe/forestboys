/**
 * The list's index in R2 (#184): one small object per bundle, `proposals/index/<bundleId>.json`, whose custom metadata is the
 * row the list shows (src/utils/bundleIndex.ts). The list endpoint lists them once and reads none: its cost no longer grows
 * with the payloads of every bundle, nor with one manifest read per bundle.
 *
 * The row is derived from the manifest and the comments, so it can always be rebuilt, and it is recomputed after every change
 * to a bundle (ingest, accept, deny, a refusal, a comment, archive, restore). Two editors on the same bundle both recompute
 * from the bundle as it is, so recomputing after the write is enough: no retry loop. A refresh that fails is logged and the row
 * stays as it was until the next change or a rebuild («Bygg indeksen på nytt»), because the action it follows has already
 * happened.
 */

import { originKind, originLabel } from './bundle-origin.ts'
import { listCommentRefs } from './bundle-comments.ts'
import type { BundleManifest } from './bundle-validate.ts'
import { INDEX_PREFIX, fromMetadata, indexKey, rowOf, toMetadata, type BundleRow } from '../../src/utils/bundleIndex.ts'

const CHUNK = 40
const MANIFEST_RE = /^proposals\/bundles\/([^/]+)\/manifest\.json$/
const COMMENT_RE  = /^proposals\/bundles\/([^/]+)\/comments\//

async function put(bucket: R2Bucket, row: BundleRow): Promise<void> {
  await bucket.put(indexKey(row.bundleId), JSON.stringify(row), { httpMetadata: { contentType: 'application/json' }, customMetadata: toMetadata(row) })
}

const bundleRow = (m: BundleManifest, comments: number, updatedAt: string) =>
  rowOf(m, { source: originLabel(m), originKind: originKind(m), comments, updatedAt })

/** Recompute one bundle's row. A bundle that is not there has no row. */
export async function refreshRowStrict(bucket: R2Bucket, bundleId: string): Promise<void> {
  const obj = await bucket.get(`proposals/bundles/${bundleId}/manifest.json`)
  if (!obj) return removeRow(bucket, bundleId)
  const manifest = await obj.json<BundleManifest>()
  const comments = (await listCommentRefs(bucket, bundleId)).length
  await put(bucket, bundleRow(manifest, comments, new Date().toISOString()))
}

/** `refreshRowStrict` that logs a failure instead of throwing it: the action it follows has happened. */
export async function refreshRow(bucket: R2Bucket, bundleId: string): Promise<void> {
  try { await refreshRowStrict(bucket, bundleId) }
  catch (e) { console.error(`index row for ${bundleId} not refreshed:`, (e as Error).message) }
}

export async function removeRow(bucket: R2Bucket, bundleId: string): Promise<void> {
  await bucket.delete(indexKey(bundleId))
}

async function listAll(bucket: R2Bucket, prefix: string): Promise<{ key: string; customMetadata?: Record<string, string> }[]> {
  const out: { key: string; customMetadata?: Record<string, string> }[] = []
  let cursor: string | undefined
  do {
    const listing = await bucket.list({ prefix, cursor, include: ['customMetadata'] })
    for (const o of listing.objects) out.push({ key: o.key, customMetadata: o.customMetadata })
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)
  return out
}

/** Every row: one listing with the metadata (a call per thousand bundles), no object read. */
export async function listRows(bucket: R2Bucket): Promise<BundleRow[]> {
  return (await listAll(bucket, INDEX_PREFIX)).map(o => fromMetadata(o.customMetadata)).filter((r): r is BundleRow => r !== null)
}

/**
 * Build the index from the bundles themselves: for the bundles from before the index, and when a row went stale. The one path
 * that reads a manifest per bundle, so it is an explicit act (and the first load of an empty index), not every load.
 */
export async function rebuildIndex(bucket: R2Bucket): Promise<{ rows: number; removed: number }> {
  const objects   = await listAll(bucket, 'proposals/bundles/')
  const manifests = objects.map(o => o.key.match(MANIFEST_RE)).filter((m): m is RegExpMatchArray => m !== null)
  const comments  = new Map<string, number>()
  for (const o of objects) { const c = o.key.match(COMMENT_RE); if (c) comments.set(c[1], (comments.get(c[1]) ?? 0) + 1) }
  const before = new Map((await listRows(bucket)).map(r => [r.bundleId, r]))

  const alive = new Set<string>()
  for (let i = 0; i < manifests.length; i += CHUNK) {
    await Promise.all(manifests.slice(i, i + CHUNK).map(async (m) => {
      try {
        const obj = await bucket.get(m[0])
        if (!obj) return
        const manifest = await obj.json<BundleManifest>()
        alive.add(manifest.bundleId)
        // The time of the last change is not in the manifest: keep the row's own, else the day it was made.
        const updatedAt = before.get(manifest.bundleId)?.updatedAt ?? manifest.createdAt
        await put(bucket, bundleRow(manifest, comments.get(manifest.bundleId) ?? 0, updatedAt))
      } catch (e) { console.error(`index: ${m[1]} skipped:`, (e as Error).message) }
    }))
  }
  const stale = [...before.keys()].filter(id => !alive.has(id))
  for (const id of stale) await removeRow(bucket, id)
  return { rows: alive.size, removed: stale.length }
}
