/**
 * useDetailCreateMode — shared create-mode plumbing for entity detail
 * pages (Org, Person, and the upcoming Unit/Station/Transport refactors).
 *
 * Each detail page is mounted at `/<kind>/:slug`. When `:slug` is the
 * sentinel `new`, the page enters create mode — the EditPane renders
 * with `createMode=true`, the scalar editor POSTs instead of PATCHing,
 * and on success the create form chains a sections PATCH then routes
 * to the real `/<kind>/<newSlug>`.
 *
 * Three pieces are identical across kinds; this composable owns them:
 *
 *  - `isCreate` derived from the slug (useDetailSlug).
 *  - The `mode` ref (Preview ↔ Edit), forced to `edit` on create so the
 *    user lands typing instead of staring at an empty preview.
 *  - The `pendingDescription` recovery handoff: when the create flow
 *    fails to save the description but the entity exists, it stashes
 *    the draft via `usePendingDescription`. On the next mount at the
 *    real slug we consume it, seed the editor as dirty, and force edit
 *    mode so the user can retry without retyping.
 *
 * The page wires its own `onSectionsSaved` (since `savedSections` is
 * per-page state), but should call `clearPending()` from there so a
 * successful Lagre dismisses the recovery banner.
 */
import { ref, computed, watch, inject } from 'vue'
import { useRouter } from 'vue-router'
import { useDetailSlug } from './useDetailSlug.ts'
import { consumePendingDescription, type PendingDescription, type PendingKind } from './usePendingDescription.ts'
import { ProposalPreviewKey } from './proposalDataInjection.ts'
import type { AdminViewMode } from '@/components/AdminViewTabs.vue'

export interface UseDetailCreateModeOptions {
  /** Pending-description kind tag — must match what the create form stashes. */
  kind: PendingKind
  /** Path prefix for navigation after `onCreated`, e.g. `/organization`. */
  pathPrefix: string
}

export function useDetailCreateMode(opts: UseDetailCreateModeOptions) {
  const router = useRouter()

  const slug      = useDetailSlug()
  const isCreate  = computed(() => slug.value === 'new')
  const mode      = ref<AdminViewMode>('preview')
  const pendingDescription = ref<PendingDescription | null>(null)

  const inProposalPreview = inject(ProposalPreviewKey, false)

  // Force edit mode whenever we land on /<kind>/new — preview pane has
  // no saved data yet (the in-progress draft renders via header/preview
  // overlays from the editors' defineExpose). Skipped while previewing
  // a proposal: edits there would mutate live state, not the bundle.
  watch(isCreate, v => { if (v && !inProposalPreview) mode.value = 'edit' }, { immediate: true })

  // Recovery: a description draft from a previous failed create attempt
  // is stashed at the module level. On slug change we consume any
  // matching entry, seed the editor, and force edit mode.
  watch(slug, (s) => {
    if (inProposalPreview) return
    const p = consumePendingDescription(opts.kind, s)
    if (p) {
      pendingDescription.value = p
      mode.value = 'edit'
    }
  }, { immediate: true })

  function onCreated(newSlug: string) {
    void router.replace(`${opts.pathPrefix}/${newSlug}`)
  }

  /** Page should call this from its `onSectionsSaved` handler so a
   *  successful save dismisses the recovery banner. */
  function clearPending() {
    pendingDescription.value = null
  }

  return { slug, isCreate, mode, pendingDescription, onCreated, clearPending }
}
