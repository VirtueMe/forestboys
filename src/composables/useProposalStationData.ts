/**
 * Controller-view preview wrapper for Station. See useProposalPersonData.
 *
 * Implements modify-block + create-entity skeleton. Edge merge for
 * Station's stays (STATIONED_AT) is deferred until the controller-view
 * refactor consumes it.
 */
import { ref, computed } from 'vue'
import { useStationData } from './useStationData.ts'
import type { StationCategory } from '@/utils/stationCategory.ts'
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

export function useProposalStationData(bundleId: string, entityId: string) {
  const live   = useStationData()
  const bundle = useProposalBundle(bundleId)

  const _proposal = ref<ProposalSidecar>({
    bundleId, entityId, status: 'pending', payload: null, loading: true, error: null,
  })

  const slug = computed(() => {
    const m = entityId.match(/^Station:([a-z0-9-]+)$/)
    return m ? m[1] : null
  })

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

      if (!slug.value) throw new Error(`useProposalStationData: ${entityId} is not a Station id`)

      const createOp = payload.ops.find((o) => o.op === 'create-entity')
      if (createOp && createOp.op === 'create-entity') {
        const props = createOp.props as Partial<{
          canonicalName: string
          type:          string | null
          category:      StationCategory | null
          lat:           number | null
          lng:           number | null
          activeFrom:    string | null
          activeTo:      string | null
          description:   string | null
          links:         string | null
        }>
        live.station.value = {
          name:        props.canonicalName ?? createOp.slug,
          type:        props.type        ?? null,
          category:    props.category    ?? null,
          lat:         props.lat         ?? null,
          lng:         props.lng         ?? null,
          activeFrom:  props.activeFrom  ?? null,
          activeTo:    props.activeTo    ?? null,
          description: props.description ?? null,
          links:       props.links       ?? null,
        }
        live.savedSections.value = synthesizeSectionsFromModifyOps(payload)
      } else {
        await live.loadStation(slug.value)
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
    live.resetStation()
    _proposal.value.payload = null
    _proposal.value.error   = null
    _proposal.value.status  = 'pending'
  }

  return {
    ...live,
    loadStation: loadPreview,
    resetStation: reset,
    _proposal,
    accept,
    deny,
  }
}
