/**
 * Archive, restore and purge of a bundle in R2 (#188). The format, the metadata and the budget are in
 * src/utils/bundleArchive.ts; docs/PROPOSALS.md, «Archive».
 *
 * Order matters, because R2 has no transaction: the archive object is written first and the originals deleted after it, so
 * a failure half way leaves a bundle that is both archived and still there (harmless, and a second try finishes it); a restore
 * writes the manifest last and removes the archive object last, for the same reason.
 */

import { indexAdd, indexRemove } from '~/api/admin/proposals/_apply.ts'
import { sourceIndexKey } from './bundle-origin.ts'
import { recordEvent } from './bundle-events.ts'
import { writeComment } from './bundle-comments.ts'
import type { BundleManifest } from './bundle-validate.ts'
import {
  ARCHIVE_PREFIX, OPERATION_LIMIT, archiveKey, fromMetadata, operationsNeeded, purgedKey, summaryOf, toMetadata,
  type ArchiveRecord, type ArchiveSummary, type ArchivedObject,
} from '../../src/utils/bundleArchive.ts'
import type { EventActor } from '../../src/utils/bundleEvents.ts'

export class ArchiveError extends Error {
  constructor(readonly status: 404 | 409 | 413, message: string) { super(message) }
}

const bundlePrefix = (bundleId: string) => `proposals/bundles/${bundleId}/`
const CHUNK = 40

async function inChunks<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(...await Promise.all(items.slice(i, i + CHUNK).map(fn)))
  return out
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

const pendingOf = (m: BundleManifest) => m.entities.filter(e => e.status === 'pending').map(e => e.entityId)

/** Archive: the whole bundle becomes one object, then leaves the lists. Returns what it kept. */
export async function archiveBundle(bucket: R2Bucket, bundleId: string, actor: EventActor, reason: string): Promise<ArchiveSummary> {
  const manifestObj = await bucket.get(`${bundlePrefix(bundleId)}manifest.json`)
  if (!manifestObj) throw new ArchiveError(404, 'Bundle not found')
  const manifest = await manifestObj.json<BundleManifest>()

  // Too big is found out before anything is written, so a refusal leaves the bundle exactly as it was.
  const pending = pendingOf(manifest)
  const needed  = operationsNeeded((await listAll(bucket, bundlePrefix(bundleId))).length, pending.length)
  if (needed > OPERATION_LIMIT) throw new ArchiveError(413, `bundle is too big to archive in one go (${needed} operations, the limit is ${OPERATION_LIMIT})`)

  // The reason is a comment on the bundle, so it is in its thread, goes into the archive with it and is still there after a
  // restore; the log says that it was written and that the bundle was archived. All three go in before the snapshot.
  // Times given, one millisecond apart, so the log reads in that order whatever the names' random suffixes are.
  const t0 = Date.now()
  const iso = (ms: number) => new Date(t0 + ms).toISOString()
  const comment = await writeComment(bucket, bundleId, actor, { type: 'bundle', text: `Arkivert: ${reason}` }, iso(0))
  await recordEvent(bucket, bundleId, actor, { kind: 'commented', commentId: comment.id, scope: 'bundle' }, iso(0))
  await recordEvent(bucket, bundleId, actor, { kind: 'archived', reason }, iso(1))

  const listed = await listAll(bucket, bundlePrefix(bundleId))
  const at      = new Date().toISOString()
  const summary = summaryOf(manifest, { actor, at, reason })
  const objects: Record<string, ArchivedObject> = {}
  await inChunks(listed, async (o) => {
    const obj = await bucket.get(o.key)
    if (!obj) return
    objects[o.key.slice(bundlePrefix(bundleId).length)] = { value: await obj.json<unknown>(), ...(o.customMetadata ? { customMetadata: o.customMetadata } : {}) }
  })
  const record: ArchiveRecord = { ...summary, objects }
  await bucket.put(archiveKey(bundleId), JSON.stringify(record), {
    httpMetadata:   { contentType: 'application/json' },
    customMetadata: toMetadata(summary),
  })

  // Off the lists of open bundles, as «Slett» always did. Entities that were decided left their index when they were decided.
  for (const entityId of pending) await indexRemove({ PROPOSALS: bucket }, `proposals/by-entity/${entityId}/index.json`, bundleId)
  await indexRemove({ PROPOSALS: bucket }, sourceIndexKey(manifest), bundleId)

  for (let i = 0; i < listed.length; i += 1000) await bucket.delete(listed.slice(i, i + 1000).map(o => o.key))
  return summary
}

/** The archived bundles, newest archived first: one listing with the metadata, no body read. */
export async function listArchive(bucket: R2Bucket): Promise<ArchiveSummary[]> {
  const rows = (await listAll(bucket, ARCHIVE_PREFIX)).map(o => fromMetadata(o.customMetadata)).filter((s): s is ArchiveSummary => s !== null)
  return rows.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
}

export async function readArchive(bucket: R2Bucket, bundleId: string): Promise<ArchiveRecord> {
  const obj = await bucket.get(archiveKey(bundleId))
  if (!obj) throw new ArchiveError(404, 'Archived bundle not found')
  return await obj.json<ArchiveRecord>()
}

/** Restore: the objects come back, manifest last, and the pending entities are in the open-bundle lists again. The reason is optional. */
export async function restoreBundle(bucket: R2Bucket, bundleId: string, actor: EventActor, reason: string | null = null): Promise<void> {
  const record = await readArchive(bucket, bundleId)
  if (!record.restorable) throw new ArchiveError(409, 'Bundle has accepted entities: its ops are in the graph, so it stays an archived record')
  if (await bucket.get(`${bundlePrefix(bundleId)}manifest.json`)) throw new ArchiveError(409, 'A bundle with this id is there already')

  const manifest = (record.objects['manifest.json']?.value) as BundleManifest | undefined
  if (!manifest) throw new ArchiveError(409, 'The archive has no manifest')
  const pending = pendingOf(manifest)
  const entries = Object.entries(record.objects)
  const needed  = operationsNeeded(entries.length, pending.length)
  if (needed > OPERATION_LIMIT) throw new ArchiveError(413, `bundle is too big to restore in one go (${needed} operations, the limit is ${OPERATION_LIMIT})`)

  const put = (rel: string, o: ArchivedObject) => bucket.put(`${bundlePrefix(bundleId)}${rel}`, JSON.stringify(o.value), {
    httpMetadata: { contentType: 'application/json' },
    ...(o.customMetadata ? { customMetadata: o.customMetadata } : {}),
  })
  await inChunks(entries.filter(([rel]) => rel !== 'manifest.json'), ([rel, o]) => put(rel, o))
  await put('manifest.json', record.objects['manifest.json'])

  for (const entityId of pending) await indexAdd({ PROPOSALS: bucket }, `proposals/by-entity/${entityId}/index.json`, bundleId)
  await indexAdd({ PROPOSALS: bucket }, sourceIndexKey(manifest), bundleId)

  // The optional reason is a comment on the bundle, like the one that archived it; the log says that it was restored, then points at it.
  const t0 = Date.now()
  const iso = (ms: number) => new Date(t0 + ms).toISOString()
  await recordEvent(bucket, bundleId, actor, { kind: 'restored', ...(reason ? { reason } : {}) }, iso(0))
  if (reason) {
    const comment = await writeComment(bucket, bundleId, actor, { type: 'bundle', text: `Gjenopprettet: ${reason}` }, iso(1))
    await recordEvent(bucket, bundleId, actor, { kind: 'commented', commentId: comment.id, scope: 'bundle' }, iso(1))
  }
  await bucket.delete(archiveKey(bundleId))
}

/** Purge: the archived bundle is removed for good. A short record of who, when and why stays, so it is not as if it never was. */
export async function purgeArchive(bucket: R2Bucket, bundleId: string, actor: EventActor, reason: string): Promise<void> {
  const record = await readArchive(bucket, bundleId)
  const summary: Partial<ArchiveRecord> = { ...record }
  delete summary.objects
  await bucket.put(purgedKey(bundleId), JSON.stringify({ ...summary, purgedAt: new Date().toISOString(), purgedBy: actor, purgeReason: reason }), {
    httpMetadata: { contentType: 'application/json' },
  })
  await bucket.delete(archiveKey(bundleId))
}
