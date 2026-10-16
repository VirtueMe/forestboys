/**
 * The records of #273 in R2: one small object per entity and bundle, `proposals/by-entity/<entityId>/<bundleId>.json`, whose
 * custom metadata says what the bundle changes in the entity and in what state (src/utils/entityRecord.ts). docs/PROPOSALS.md,
 * «Entity records».
 *
 * Each entity-in-bundle pair has one writer at a time, so a write is a plain `put`: no read-modify-write, no retry loop. The
 * record is derived from the bundle, so a failed write after the action it follows is logged and left for the backfill.
 */

import type { R2Bucket } from '@cloudflare/workers-types'   // the scripts' project has no global one
import {
  ENTITY_RECORD_PREFIX, bodyOf, entityPrefix, fromMetadata, newestFirst, payloadKey, recordKey, recordOf, toMetadata,
  type EntityRecord, type EntityRecordStatus, type OpLike,
} from '../../src/utils/entityRecord.ts'
import { ARCHIVE_PREFIX, archiveKey, type ArchiveRecord } from '../../src/utils/bundleArchive.ts'
import type { BundleManifest } from './bundle-validate.ts'

export async function writeRecord(bucket: R2Bucket, record: EntityRecord): Promise<void> {
  await bucket.put(recordKey(record.entityId, record.bundleId), JSON.stringify(bodyOf(record)), {
    httpMetadata:   { contentType: 'application/json' },
    customMetadata: toMetadata(record),
  })
}

/** A bundle's entity arrives: the record is written as it is derived from the ops. */
export const writeRecordFor = (bucket: R2Bucket, bundleId: string, entityId: string, status: EntityRecordStatus, ops: readonly OpLike[]) =>
  writeRecord(bucket, recordOf(bundleId, entityId, status, ops))

/**
 * Change the state of a record and keep the rest. Returns false when there is no record (a bundle from before #273 that the
 * backfill has not reached), which is nothing to fail on. Metadata is read from the object itself, so the lists survive.
 */
export async function setRecordStatus(bucket: R2Bucket, entityId: string, bundleId: string, status: EntityRecordStatus): Promise<boolean> {
  const key  = recordKey(entityId, bundleId)
  const head = await bucket.head(key)
  if (!head) return false
  const record = fromMetadata(entityId, key, head.customMetadata)
  if (!record) return false
  await writeRecord(bucket, { ...record, status })
  return true
}

/** `setRecordStatus` that logs a failure instead of throwing it: the action it follows has happened. */
export async function setRecordStatusSafe(bucket: R2Bucket, entityId: string, bundleId: string, status: EntityRecordStatus): Promise<void> {
  try { await setRecordStatus(bucket, entityId, bundleId, status) }
  catch (e) { console.error(`entity record ${entityId} / ${bundleId} not set to ${status}:`, (e as Error).message) }
}

/** Up to this many entities are listed one by one; a bigger bundle reads all the records once and keeps its entities'. */
const PER_ENTITY_LISTINGS = 30

/**
 * The records of several entities, by entity id. A listing is a subrequest, and a Worker has 1,000 of them: a bundle of 287
 * entities would spend 287 on this alone, so past a few entities one pass over every record is cheaper (a call per thousand).
 */
export async function listRecordsFor(bucket: R2Bucket, entityIds: readonly string[]): Promise<Map<string, EntityRecord[]>> {
  const out = new Map<string, EntityRecord[]>(entityIds.map(id => [id, []]))
  if (entityIds.length <= PER_ENTITY_LISTINGS) {
    await Promise.all(entityIds.map(async id => { out.set(id, await listRecords(bucket, id)) }))
    return out
  }
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: ENTITY_RECORD_PREFIX, cursor, include: ['customMetadata'] })
    for (const o of page.objects) {
      const entityId = o.key.slice(ENTITY_RECORD_PREFIX.length).split('/')[0]
      if (!out.has(entityId)) continue
      const r = fromMetadata(entityId, o.key, o.customMetadata)
      if (r) out.get(entityId)!.push(r)
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  for (const records of out.values()) records.sort(newestFirst)
  return out
}

/** Every record of an entity, in any state: one listing with the metadata (a call per thousand), no body read. */
export async function listRecords(bucket: R2Bucket, entityId: string): Promise<EntityRecord[]> {
  const out: EntityRecord[] = []
  let cursor: string | undefined
  do {
    const listing = await bucket.list({ prefix: entityPrefix(entityId), cursor, include: ['customMetadata'] })
    for (const o of listing.objects) {
      const r = fromMetadata(entityId, o.key, o.customMetadata)
      if (r) out.push(r)
    }
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)
  return out.sort(newestFirst)
}

/* ─────────────── Backfill: the records of bundles from before #273 ─────────────── */

const BUNDLES = 'proposals/bundles/'
const COST_LIVE    = 3   // head the record, read the payload, write the record
const COST_ARCHIVE = 2   // head the record, write the record (the archive object holds the payloads)

export interface BackfillOptions {
  /** Without it nothing is written: the result says what would be. */
  write:   boolean
  /** Operations on R2 this call may spend, for a Worker's subrequest limit; unlimited when absent (a script). */
  budget?: number
  /** `next` of the call before. */
  cursor?: string | null
}

export interface BackfillResult {
  bundles:   number
  entities:  number
  /** Records that were missing or differed: written with `write`, otherwise what would be written. */
  changed:   number
  unchanged: number
  /** Entities whose payload was not there, so the record has no ops. */
  noPayload: number
  /** Where the next call starts, or null when this one reached the end. */
  next:      string | null
}

interface Unit { kind: 'live' | 'archive'; id: string }

async function listBundleIds(bucket: R2Bucket): Promise<Unit[]> {
  const out: Unit[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: BUNDLES, delimiter: '/', cursor })
    for (const p of page.delimitedPrefixes) out.push({ kind: 'live', id: p.slice(BUNDLES.length, -1) })
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  cursor = undefined
  do {
    const page = await bucket.list({ prefix: ARCHIVE_PREFIX, cursor })
    for (const o of page.objects) out.push({ kind: 'archive', id: o.key.slice(ARCHIVE_PREFIX.length, -'.json'.length) })
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}

const sameMetadata = (a: Record<string, string> | undefined, b: Record<string, string>) =>
  !!a && Object.keys(b).length === Object.keys(a).length && Object.entries(b).every(([k, v]) => a[k] === v)

/**
 * Write the records of the bundles that were there before the records were: one per entity of every manifest, its status the
 * manifest's, its ops summary from the payload. An archived bundle's pending entities are `archived`. The record is derived,
 * so running it again changes nothing that is right already, and a record that went wrong is put right.
 *
 * R2 has no transaction and a Worker has a subrequest limit, so it works through the bundles in order and stops when `budget`
 * is spent, saying where to go on from (`next`); the caller calls again until `next` is null. A script has no budget.
 */
export async function backfillEntityRecords(bucket: R2Bucket, opts: BackfillOptions): Promise<BackfillResult> {
  const result: BackfillResult = { bundles: 0, entities: 0, changed: 0, unchanged: 0, noPayload: 0, next: null }
  let left = (opts.budget ?? Infinity) - 2   // the listings
  const units = await listBundleIds(bucket)
  const [startKind, startId, startOffset] = (opts.cursor ?? '').split('|')
  let first = startKind ? units.findIndex(u => u.kind === startKind && u.id === startId) : 0
  if (first < 0) first = 0
  let offset = startKind ? Number(startOffset) || 0 : 0

  for (const unit of units.slice(first)) {
    let manifest: BundleManifest | undefined
    let objects: Record<string, { value: unknown }> | undefined
    if (unit.kind === 'live') {
      left -= 1
      manifest = await (await bucket.get(`${BUNDLES}${unit.id}/manifest.json`))?.json<BundleManifest>()
    } else {
      left -= 1
      objects = (await (await bucket.get(archiveKey(unit.id)))?.json<ArchiveRecord>())?.objects
      manifest = objects?.['manifest.json']?.value as BundleManifest | undefined
    }
    if (!manifest) { offset = 0; continue }
    const cost = unit.kind === 'live' ? COST_LIVE : COST_ARCHIVE

    for (let i = offset; i < manifest.entities.length; i++) {
      if (left < cost) { result.next = `${unit.kind}|${unit.id}|${i}`; return result }
      left -= cost
      const ref = manifest.entities[i]
      const payload = unit.kind === 'live'
        ? await (await bucket.get(payloadKey(ref.entityId, unit.id)))?.json<{ ops?: OpLike[] }>()
        : objects?.[`entity/${ref.entityId}.json`]?.value as { ops?: OpLike[] } | undefined
      if (!payload?.ops) result.noPayload++
      const status: EntityRecordStatus = unit.kind === 'archive' && ref.status === 'pending' ? 'archived' : ref.status
      const record = recordOf(unit.id, ref.entityId, status, payload?.ops ?? [])
      const key  = recordKey(ref.entityId, unit.id)
      const meta = toMetadata(record)
      result.entities++
      if (sameMetadata((await bucket.head(key))?.customMetadata, meta)) { result.unchanged++; continue }
      result.changed++
      if (opts.write) await writeRecord(bucket, record)
    }
    result.bundles++
    offset = 0
  }
  return result
}

/**
 * Delete the old shared `proposals/by-entity/<entityId>/index.json` files, once nothing reads them (the readers have switched).
 * Deleting them all in one Worker call exceeds its limits, so `limit` caps the deletes of one call and the caller calls again
 * until `found` is no more than `deleted`. A script has no limit.
 */
export async function dropOldIndexes(bucket: R2Bucket, opts: { write: boolean; limit?: number }): Promise<{ found: number; deleted: number }> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: ENTITY_RECORD_PREFIX, cursor })
    for (const o of page.objects) if (o.key.endsWith('/index.json')) keys.push(o.key)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  const doomed = opts.write ? keys.slice(0, opts.limit ?? keys.length) : []
  for (let i = 0; i < doomed.length; i += 1000) await bucket.delete(doomed.slice(i, i + 1000))
  return { found: keys.length, deleted: doomed.length }
}
