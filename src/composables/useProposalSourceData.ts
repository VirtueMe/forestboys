/**
 * Proposal-preview wrapper for Source. Same shape as the others, but keyed
 * by `id` (a Source has no slug; the bundle's create op carries it as `slug`).
 *
 * Edges are not merged into the preview: the panel lists the bundle's
 * edges under it.
 */
import { ref, computed } from 'vue'
import { useSourceData } from './useSourceData.ts'
import { useProposalBundle, type EntityStatus, type EntityPayload } from './useProposalBundle.ts'
import { applyModifyBlockOps, computeExpectedShas, synthesizeSectionsFromModifyOps } from './proposalMerge.ts'

interface ProposalSidecar {
  bundleId: string
  entityId: string
  status:   EntityStatus
  payload:  EntityPayload | null
  loading:  boolean
  error:    string | null
}

export function useProposalSourceData(bundleId: string, entityId: string) {
  const live   = useSourceData()
  const bundle = useProposalBundle(bundleId)

  const _proposal = ref<ProposalSidecar>({
    bundleId, entityId, status: 'pending', payload: null, loading: true, error: null,
  })

  const slug = computed(() => entityId.match(/^Source:(\S+)$/)?.[1] ?? null)

  async function loadPreview(): Promise<void> {
    _proposal.value.loading = true
    _proposal.value.error   = null
    try {
      await bundle.load()
      const ref     = bundle.getEntityRef(entityId)
      const payload = bundle.getEntityPayload(entityId)
      if (!ref || !payload) throw new Error(`Entity ${entityId} not found in bundle ${bundleId}`)
      _proposal.value.status  = ref.status
      _proposal.value.payload = payload

      if (!slug.value) throw new Error(`useProposalSourceData: ${entityId} is not a Source id`)

      const createOp = payload.ops.find((o) => o.op === 'create-entity')
      if (createOp && createOp.op === 'create-entity') {
        const props = createOp.props as Partial<{
          title:          string | null
          type:           string | null
          url:            string | null
          authorFreeText: string | null
          publishedDate:  string | null
        }>
        live.source.value = {
          id:             createOp.slug,
          title:          props.title          ?? null,
          type:           props.type           ?? null,
          url:            props.url            ?? null,
          authorFreeText: props.authorFreeText ?? null,
          publishedDate:  props.publishedDate  ?? null,
        }
        live.savedSections.value = synthesizeSectionsFromModifyOps(payload)
      } else {
        await live.loadSource(slug.value)
        applyModifyBlockOps(payload, live.savedSections.value)
      }
    } catch (e) {
      _proposal.value.error = (e as Error).message
    } finally {
      _proposal.value.loading = false
    }
  }

  async function accept(message: string | null = null) {
    const expectedShas = await computeExpectedShas(_proposal.value.payload, live.savedSections.value)
    const result = await bundle.accept(entityId, expectedShas, message)
    _proposal.value.status = 'accepted'
    return result
  }

  async function deny(reason: string) {
    const result = await bundle.deny(entityId, reason)
    _proposal.value.status = 'denied'
    return result
  }

  function reset() {
    live.resetSource()
    _proposal.value.payload = null
    _proposal.value.error   = null
    _proposal.value.status  = 'pending'
  }

  return {
    ...live,
    loadSource: loadPreview,
    resetSource: reset,
    _proposal,
    accept,
    deny,
  }
}
