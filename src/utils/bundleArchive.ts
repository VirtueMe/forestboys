/**
 * The archive of a proposal bundle (#188): what is kept, what a listing says about it, and what may be done to it.
 * Pure, shared by the endpoints (functions/_lib/bundle-archive.ts) and the pages. docs/PROPOSALS.md, «Archive».
 *
 * «Slett» archives: the whole bundle is written as ONE object, `proposals/archive/<bundleId>.json`, and the originals are
 * deleted after it. R2 cannot move objects, and a bundle can have hundreds. The listing of the archive reads the object's custom
 * metadata (the summary below), never a body.
 */

import { bundleCounts, bundleStatus, type BundleCounts, type BundleStatus } from './bundleStatus.ts'
import type { EventActor } from './bundleEvents.ts'

export const ARCHIVE_PREFIX = 'proposals/archive/'
export const archiveKey = (bundleId: string) => `${ARCHIVE_PREFIX}${bundleId}.json`
export const purgedKey  = (bundleId: string) => `proposals/purged/${bundleId}.json`

export const REASON_MIN = 4
export const REASON_MAX = 500

/** What a listing of the archive knows about a bundle (the object's custom metadata): enough for a row. */
export interface ArchiveSummary {
  bundleId:    string
  summary:     string
  createdAt:   string
  archivedAt:  string
  /** Who archived it: the name at the time (the page shows the current one, by `archivedById`). */
  archivedBy:  string
  archivedById?: string
  reason:      string
  status:      BundleStatus
  counts:      BundleCounts
  entities:    number
  /** False once any entity was accepted: the ops are in the graph, and the bundle stays an archived record. */
  restorable:  boolean
}

/** Everything under the bundle's prefix, by its key below the prefix. The values are the parsed JSON of each object. */
export interface ArchivedObject { value: unknown; customMetadata?: Record<string, string> }

export interface ArchiveRecord extends ArchiveSummary {
  objects: Record<string, ArchivedObject>
}

/** The reason for archiving or purging: written down, so the next editor knows why. */
export function validateReason(body: unknown): string | { error: string } {
  const r = body && typeof body === 'object' ? (body as Record<string, unknown>).reason : undefined
  const text = typeof r === 'string' ? r.trim() : ''
  if (text.length < REASON_MIN) return { error: `reason required (at least ${REASON_MIN} characters)` }
  if (text.length > REASON_MAX) return { error: `reason is longer than ${REASON_MAX} characters` }
  return text
}

/** The optional reason for a restore: none is fine, and an empty one is none. Null for none, the text, or why it is refused. */
export function validateOptionalReason(body: unknown): string | null | { error: string } {
  const r = body && typeof body === 'object' ? (body as Record<string, unknown>).reason : undefined
  if (r === undefined || r === null) return null
  if (typeof r !== 'string') return { error: 'reason must be text' }
  const text = r.trim()
  if (text.length > REASON_MAX) return { error: `reason is longer than ${REASON_MAX} characters` }
  return text || null
}

export function isRestorable(counts: BundleCounts): boolean {
  return counts.accepted === 0
}

export function summaryOf(
  m: { bundleId: string; summary: string; createdAt: string; status?: BundleStatus; entities: { status: string }[] },
  by: { actor: EventActor; at: string; reason: string },
): ArchiveSummary {
  const counts = bundleCounts(m.entities)
  return {
    bundleId:   m.bundleId,
    summary:    m.summary,
    createdAt:  m.createdAt,
    archivedAt: by.at,
    archivedBy: 'name' in by.actor ? by.actor.name : by.actor.channel,
    ...('id' in by.actor && by.actor.id ? { archivedById: by.actor.id } : {}),
    reason:     by.reason,
    status:     bundleStatus(m),
    counts,
    entities:   m.entities.length,
    restorable: isRestorable(counts),
  }
}

/**
 * R2 allows 2 KB of custom metadata in all, as strings. The long texts are cut, so a row never makes the write fail; the
 * whole text is in the object.
 */
export function toMetadata(s: ArchiveSummary): Record<string, string> {
  const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
  return {
    bundleId:   s.bundleId,
    summary:    cut(s.summary, 300),
    createdAt:  s.createdAt,
    archivedAt: s.archivedAt,
    archivedBy: cut(s.archivedBy, 80),
    ...(s.archivedById ? { archivedById: cut(s.archivedById, 80) } : {}),
    reason:     cut(s.reason, 300),
    status:     s.status,
    counts:     [s.counts.pending, s.counts.accepted, s.counts.denied, s.counts.drifted].join(','),
    entities:   String(s.entities),
    restorable: s.restorable ? '1' : '0',
  }
}

export function fromMetadata(m: Record<string, string> | undefined): ArchiveSummary | null {
  if (!m?.bundleId || !m.archivedAt) return null
  const [pending, accepted, denied, drifted] = (m.counts ?? '').split(',').map(n => Number(n) || 0)
  return {
    bundleId:   m.bundleId,
    summary:    m.summary ?? '',
    createdAt:  m.createdAt ?? '',
    archivedAt: m.archivedAt,
    archivedBy: m.archivedBy ?? '',
    ...(m.archivedById ? { archivedById: m.archivedById } : {}),
    reason:     m.reason ?? '',
    status:     m.status === 'blocked' || m.status === 'closed' ? m.status : 'pending',
    counts:     { pending: pending ?? 0, accepted: accepted ?? 0, denied: denied ?? 0, drifted: drifted ?? 0 },
    entities:   Number(m.entities) || 0,
    restorable: m.restorable === '1',
  }
}

/**
 * Archive and restore cost R2 operations: a read or a write per object, and two per pending entity for its indexes (and a few more for the reason's comment and the events). A Worker
 * may make about a thousand; the biggest bundle of #158 (287 payloads, all pending) is about 870. Past this limit the bundle is
 * refused, with the number, instead of failing half way.
 */
export const OPERATION_LIMIT = 950

export function operationsNeeded(objects: number, pendingEntities: number): number {
  return objects + 2 * pendingEntities + 12
}
