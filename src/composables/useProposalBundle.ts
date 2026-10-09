/**
 * useProposalBundle — fetches one proposal bundle (manifest + every
 * per-entity payload) and exposes the actions Jan needs to act on it
 * one entity at a time.
 *
 * Backed by:
 *   GET    /api/admin/proposals/<bundleId>                       (read)
 *   POST   /api/admin/proposals/<bundleId>/<entityId>/accept     (apply)
 *   POST   /api/admin/proposals/<bundleId>/<entityId>/deny       (reject)
 *
 * The kind-specific data composables (`useProposalPersonData`, etc.)
 * consume `getEntityPayload(entityId)` to merge bundle ops onto the
 * live state they fetch from Neo4j.
 */
import { ref, computed } from 'vue'
import { authFetch } from './useAuth.ts'
import type { BundleStatus } from '@/utils/bundleStatus.ts'
import type { BundleEvent } from '@/utils/bundleEvents.ts'
import type { CommentCounts } from '@/utils/bundleComments.ts'

export type EntityStatus = 'pending' | 'accepted' | 'denied' | 'drifted'

export type BundleOp =
  | { op: 'create-entity'; kind: string; slug: string; props: Record<string, unknown>; edges?: { type: string; to: string; props?: Record<string, unknown> }[]; descriptions?: { order: number; content: string }[] }
  | { op: 'modify-block'; blockPath: string; expectedSha: string; newValue: PtBlock }
  | { op: 'add-edge';     type: string; from: string; to: string; props?: Record<string, unknown> }
  | { op: 'remove-edge';  type: string; from: string; to: string }
  | { op: 'set-description'; order: number; expectedSha: string; content: string }
  | { op: 'delete-entity' }
  | { op: 'obsolete-outline'; reason: string }
  | { op: 'set-props';    props: Record<string, { from: unknown; to: unknown }> }
  | { op: 'set-kind';     to: 'Operation' | 'Incident' }

/** A set-props field whose live value no longer matches the proposal's `from`. */
export interface DriftedProp { prop: string; expected: unknown; actual: unknown }

export interface PtBlock {
  _type:    'block'
  _key:     string
  children: unknown[]
  [k: string]: unknown
}

export interface BundleEntityRef {
  entityId:  string
  status:    EntityStatus
  opSummary: string[]
  /** Why accept set the entity aside (status `drifted`): the entity exists, or a property changed. */
  refusal?:  DriftedProp[]
}

export type { BundleStatus }

/** Bundle origin — functions/_lib/bundle-origin.ts. */
export interface SanityOrigin { type: 'sanity'; sanityType: string; runAt: string }
/** A package of entity snapshots from an archive (docs/BUNDLE-FORMAT.md). */
export interface PackageOrigin { type: 'package'; site: string; madeAt: string }

export interface BundleManifest {
  bundleId:         string
  /** Outline bundles (Claude absorbing an outline). */
  outlineId?:       string
  outlineRev?:      string
  /** Sync bundles (Sanity → graph), and bundles made from a package. */
  origin?:          SanityOrigin | PackageOrigin
  summary:          string
  createdAt:        string
  model:            string
  promptHash:       string
  entities:         BundleEntityRef[]
  status?:          BundleStatus
  unresolvedRefs?:  string[]
  parentBundle?:    string
  resolvesEntities?: string[]
}

export interface EntityPayload {
  entityId:    string
  ops:         BundleOp[]
  derivedFrom:
    | { outlineId: string; outlineRev: string; sectionPath?: string }
    | { sanityId: string; sanityRev: string }
    | { source: { site: string; path: string } }
  source:      string
  generatedAt: string
  /** Set when a package's entity was matched by slug alone: it is proposed as the same entity. */
  note?:       string
}

interface BundleResponse {
  manifest: BundleManifest
  payloads: EntityPayload[]
  events:   BundleEvent[]
  commentCounts: CommentCounts
}

interface AcceptResponse {
  bundleId:         string
  entityId:         string
  status:           'accepted'
  remainingPending: number
  bundleClosed:     boolean
  outlineArchived:  boolean
}

interface DenyResponse {
  bundleId:         string
  entityId:         string
  status:           'denied'
  remainingPending: number
  bundleClosed:     boolean
}

interface DriftConflict {
  blockPath:    string
  expectedSha:  string
  actualSha:    string
  currentValue: PtBlock | null
}

export function useProposalBundle(bundleId: string) {
  const manifest = ref<BundleManifest | null>(null)
  const payloads = ref<EntityPayload[]>([])
  const events   = ref<BundleEvent[]>([])
  const commentCounts = ref<CommentCounts>({ bundle: 0, entities: {} })
  const loading  = ref(false)
  const error    = ref<string | null>(null)
  const notFound = ref(false)

  const payloadsByEntity = computed(() => {
    const map = new Map<string, EntityPayload>()
    for (const p of payloads.value) map.set(p.entityId, p)
    return map
  })

  function getEntityPayload(entityId: string): EntityPayload | null {
    return payloadsByEntity.value.get(entityId) ?? null
  }

  function getEntityRef(entityId: string): BundleEntityRef | null {
    return manifest.value?.entities.find((e) => e.entityId === entityId) ?? null
  }

  async function load(): Promise<void> {
    loading.value = true
    error.value   = null
    notFound.value = false
    try {
      const res = await authFetch(`/api/admin/proposals/${encodeURIComponent(bundleId)}`)
      if (res.status === 404) {
        notFound.value = true
        throw new Error('Bundlen finnes ikke (arkivert?)')
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json() as BundleResponse
      manifest.value = body.manifest
      payloads.value = body.payloads
      events.value   = body.events ?? []
      commentCounts.value = body.commentCounts ?? { bundle: 0, entities: {} }
    } catch (e) {
      error.value = (e as Error).message
      manifest.value = null
      payloads.value = []
      events.value   = []
      commentCounts.value = { bundle: 0, entities: {} }
    } finally {
      loading.value = false
    }
  }

  /**
   * Accept one entity. `expectedShas` is keyed by blockPath for every
   * modify-block op in the entity's payload — caller computes from the
   * live state it preview-loaded.
   *
   * Returns the server response on success. On 409 drift, throws an
   * Error tagged with the drifted blocks so the caller can surface a
   * conflict UI without re-parsing.
   */
  async function accept(
    entityId:     string,
    expectedShas: Record<string, string>,
    message:      string | null = null,
  ): Promise<AcceptResponse> {
    const res = await authFetch(
      `/api/admin/proposals/${encodeURIComponent(bundleId)}/${encodeURIComponent(entityId)}/accept`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ expectedShas, message }),
      },
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { kind?: string; driftedBlocks?: DriftConflict[]; driftedProps?: DriftedProp[]; setAside?: boolean }
      const err = new Error(body.kind ?? `HTTP ${res.status}`) as Error & { driftedBlocks?: DriftConflict[]; driftedProps?: DriftedProp[] }
      if (body.driftedBlocks) err.driftedBlocks = body.driftedBlocks
      if (body.driftedProps)  err.driftedProps  = body.driftedProps
      if (body.setAside && body.driftedProps) {
        const ref = getEntityRef(entityId)
        if (ref) { ref.status = 'drifted'; ref.refusal = body.driftedProps }
      }
      throw err
    }
    const out = await res.json() as AcceptResponse
    // Local manifest update so the caller's UI reflects the new status
    // without a refetch round-trip.
    const ref = getEntityRef(entityId)
    if (ref) ref.status = 'accepted'
    return out
  }

  async function deny(entityId: string, reason: string): Promise<DenyResponse> {
    const res = await authFetch(
      `/api/admin/proposals/${encodeURIComponent(bundleId)}/${encodeURIComponent(entityId)}/deny`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason }),
      },
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string; kind?: string }
      throw new Error(body.error ?? body.kind ?? `HTTP ${res.status}`)
    }
    const out = await res.json() as DenyResponse
    const ref = getEntityRef(entityId)
    if (ref) ref.status = 'denied'
    return out
  }

  interface AcceptAllResponse {
    bundleId:     string
    results:      { entityId: string; status: 'accepted' | 'skipped' | 'failed'; reason?: string }[]
    bundleClosed: boolean
  }
  async function acceptAll(message: string | null = null): Promise<AcceptAllResponse> {
    const res = await authFetch(
      `/api/admin/proposals/${encodeURIComponent(bundleId)}/accept-all`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message }),
      },
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
    const out = await res.json() as AcceptAllResponse
    for (const r of out.results) {
      if (r.status === 'accepted') {
        const ref = getEntityRef(r.entityId)
        if (ref) ref.status = 'accepted'
      }
    }
    return out
  }

  return {
    manifest,
    payloads,
    events,
    commentCounts,
    loading,
    error,
    notFound,
    getEntityPayload,
    getEntityRef,
    load,
    accept,
    acceptAll,
    deny,
  }
}
