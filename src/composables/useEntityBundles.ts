/**
 * useEntityBundles — open-proposal-bundle list for a single entity,
 * plus the URL-hash-synced "currently-viewed" bundle pointer and the
 * navigate/delete handlers wired into BundleReviewPanel.
 *
 * Used by every admin-facing detail page (Outline, Person, Unit, Org,
 * Station, Transport) so the "Forslag (N)" tab + inline review panel
 * looks identical everywhere.
 *
 * SSE realtime updates are outline-scoped today; pass `realtimeOutlineId`
 * to subscribe to an SSE channel (visible tab only, 10 minutes at most). Other kinds
 * re-fetch on bundle actions only (good enough until a per-entity channel is added).
 */
import { ref, computed, onUnmounted, watch, type Ref, type ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from './useAuth.ts'
import type { AdminViewMode } from '../components/AdminViewTabs.vue'

export interface OpenBundle {
  bundleId:  string
  summary:   string
  createdAt: string
}

export interface EntityBundlesOptions {
  /** Capitalized kind, e.g. "Person", "Outline". A ref when it is only known
   *  after load (an event is an Operation or an Incident) — refetches on change. */
  kind:               string | Ref<string | null | undefined>
  /** Reactive slug ref — refetch fires when this changes. */
  slug:               Ref<string | null | undefined>
  /** Reactive admin flag — gate fetch + SSE on it. */
  isAdmin:            Ref<boolean> | ComputedRef<boolean>
  /** When set, opens an SSE stream for `outlineId` and refetches on
   *  events. Currently the SSE backend keys by outlineId only. */
  realtimeOutlineId?: Ref<string | null | undefined>
}

export function useEntityBundles(opts: EntityBundlesOptions) {
  const route  = useRoute()
  const router = useRouter()

  const openBundles       = ref<OpenBundle[]>([])
  const viewingBundleId   = ref<string | null>(null)
  const generationPending = ref(false)

  const sortedBundles = computed<OpenBundle[]>(() =>
    [...openBundles.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  )
  const currentIdx = computed(() => {
    if (!sortedBundles.value.length) return -1
    if (viewingBundleId.value) {
      const idx = sortedBundles.value.findIndex((b) => b.bundleId === viewingBundleId.value)
      return idx === -1 ? 0 : idx
    }
    return 0
  })
  const currentBundle = computed<OpenBundle | null>(() =>
    currentIdx.value >= 0 ? sortedBundles.value[currentIdx.value] : null,
  )
  const newerBundle = computed<OpenBundle | undefined>(() =>
    currentIdx.value > 0 ? sortedBundles.value[currentIdx.value - 1] : undefined,
  )
  const olderBundle = computed<OpenBundle | undefined>(() =>
    currentIdx.value >= 0 && currentIdx.value < sortedBundles.value.length - 1
      ? sortedBundles.value[currentIdx.value + 1]
      : undefined,
  )

  function onBundleNavigate(bundleId: string): void {
    viewingBundleId.value = bundleId
    void router.replace({ path: route.path, query: route.query, hash: `#proposal=${encodeURIComponent(bundleId)}` })
  }

  function onBundleDeleted(): void {
    if (opts.slug.value) void loadOpenBundles(opts.slug.value)
    viewingBundleId.value = null
    void router.replace({ path: route.path, query: route.query, hash: '' })
  }

  async function loadOpenBundles(slug: string): Promise<void> {
    try {
      const kind = typeof opts.kind === 'string' ? opts.kind : opts.kind.value
      if (!kind) return
      const res = await authFetch(`/api/admin/${kind}/${slug}/proposals`)
      if (!res.ok) return
      const body = await res.json() as { openBundles?: OpenBundle[]; generationPending?: boolean }
      openBundles.value       = body.openBundles ?? []
      generationPending.value = body.generationPending ?? false
    } catch { /* silent */ }
  }

  // Sync from URL hash (#proposal=<bundleId>).
  function syncFromHash(): void {
    const m = route.hash.match(/^#proposal=(.+)$/)
    viewingBundleId.value = m ? decodeURIComponent(m[1]) : null
  }
  watch(() => route.hash, syncFromHash, { immediate: true })

  // SSE — only when an outlineId is supplied (today's channel keying). An open stream keeps the Durable Object awake,
  // and that is billed by the second, so it is open only while the tab is visible and for at most STREAM_MAX_MS.
  // Coming back to the tab reopens it with a refetch. After the cap it stays closed until then: a page left open and
  // visible stops getting live updates after 10 minutes, which is the point.
  const STREAM_MAX_MS = 10 * 60 * 1000
  let eventSource: EventSource | null = null
  let capTimer: ReturnType<typeof setTimeout> | undefined
  let streamChannel: string | null = null

  function closeEventStream(): void {
    clearTimeout(capTimer)
    eventSource?.close()
    eventSource = null
  }
  function openEventStream(channel: string): void {
    closeEventStream()
    streamChannel = channel
    eventSource = new EventSource(`/api/proposals/events?channel=${encodeURIComponent(channel)}`)
    eventSource.onmessage = () => {
      if (opts.slug.value) void loadOpenBundles(opts.slug.value)
    }
    capTimer = setTimeout(closeEventStream, STREAM_MAX_MS)
  }
  function onVisibilityChange(): void {
    if (document.hidden) { closeEventStream(); return }
    if (!streamChannel || eventSource) return
    if (opts.slug.value) void loadOpenBundles(opts.slug.value)   // whatever arrived while the stream was closed
    openEventStream(streamChannel)
  }
  if (opts.realtimeOutlineId) {
    watch(
      () => [opts.realtimeOutlineId?.value, opts.isAdmin.value] as const,
      ([oid, admin]) => {
        if (admin && typeof oid === 'string' && oid) {
          streamChannel = oid
          if (!document.hidden) openEventStream(oid)
        } else {
          streamChannel = null
          closeEventStream()
        }
      },
      { immediate: true },
    )
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    streamChannel = null
    closeEventStream()
  })

  // Refetch on kind + slug + admin changes.
  watch(
    () => [typeof opts.kind === 'string' ? opts.kind : opts.kind.value, opts.slug.value, opts.isAdmin.value] as const,
    ([, s, admin]) => {
      if (admin && typeof s === 'string' && s) void loadOpenBundles(s)
      else openBundles.value = []
    },
    { immediate: true },
  )

  /** Open the proposals tab when the URL hash (#proposal=<bundleId>) names one of
   *  this entity's open bundles — a shared link lands on the proposal, not the preview. */
  function focusOnHash(mode: Ref<AdminViewMode>): void {
    watch(
      () => [viewingBundleId.value, openBundles.value] as const,
      ([id, open]) => { if (id && open.some((b) => b.bundleId === id)) mode.value = 'proposals' },
      { immediate: true },
    )
  }

  return {
    focusOnHash,
    openBundles,
    viewingBundleId,
    generationPending,
    currentBundle,
    newerBundle,
    olderBundle,
    onBundleNavigate,
    onBundleDeleted,
    loadOpenBundles,
  }
}
