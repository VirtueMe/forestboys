/**
 * Proposal-preview wrapper for EquipmentType. Same shape as the others.
 *
 * Edges (PAIRED_WITH, REFERENCED_IN) are not merged into the page: the
 * panel lists the bundle's edges under the page.
 */
import { ref, computed } from 'vue'
import { useEquipmentData } from './useEquipmentData.ts'
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

export function useProposalEquipmentData(bundleId: string, entityId: string) {
  const live   = useEquipmentData()
  const bundle = useProposalBundle(bundleId)

  const _proposal = ref<ProposalSidecar>({
    bundleId, entityId, status: 'pending', payload: null, loading: true, error: null,
  })

  const slug = computed(() => entityId.match(/^EquipmentType:([a-z0-9-]+)$/)?.[1] ?? null)

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

      if (!slug.value) throw new Error(`useProposalEquipmentData: ${entityId} is not an EquipmentType id`)

      const createOp = payload.ops.find((o) => o.op === 'create-entity')
      if (createOp && createOp.op === 'create-entity') {
        const props = createOp.props as Partial<{
          canonicalName: string
          type:          string | null
          subtype:       string | null
          country:       string | null
          period:        string | null
        }>
        live.equipment.value = {
          slug:          createOp.slug,
          canonicalName: props.canonicalName ?? createOp.slug,
          type:          props.type    ?? null,
          subtype:       props.subtype ?? null,
          country:       props.country ?? null,
          period:        props.period  ?? null,
        }
        live.savedSections.value = synthesizeSectionsFromModifyOps(payload)
      } else {
        await live.loadEquipment(slug.value)
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
    live.resetEquipment()
    _proposal.value.payload = null
    _proposal.value.error   = null
    _proposal.value.status  = 'pending'
  }

  return {
    ...live,
    loadEquipment: loadPreview,
    resetEquipment: reset,
    _proposal,
    accept,
    deny,
  }
}
