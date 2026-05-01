/**
 * Controller-view preview wrapper for Unit. Mirrors useProposalPersonData.
 * See `docs/PROPOSALS.md` § "Controller-view preview".
 *
 * Implements modify-block + create-entity skeleton. Edge merge for Unit's
 * bespoke relation types (UnitMember, UnitParent, UnitCourse) is deferred
 * until the controller-view refactor consumes it.
 */
import { ref, computed } from 'vue'
import { useUnitData } from './useUnitData.ts'
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

export function useProposalUnitData(bundleId: string, entityId: string) {
  const live   = useUnitData()
  const bundle = useProposalBundle(bundleId)

  const _proposal = ref<ProposalSidecar>({
    bundleId, entityId, status: 'pending', payload: null, loading: true, error: null,
  })

  const slug = computed(() => {
    const m = entityId.match(/^Unit:([a-z0-9-]+)$/)
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

      if (!slug.value) throw new Error(`useProposalUnitData: ${entityId} is not a Unit id`)

      const createOp = payload.ops.find((o) => o.op === 'create-entity')
      if (createOp && createOp.op === 'create-entity') {
        const props = createOp.props as Partial<{
          canonicalName: string
          formalName:    string | null
          type:          string | null
          color:         string | null
          foundedDate:   string | null
          dissolvedDate: string | null
          country:       string | null
        }>
        live.unit.value = {
          name:          props.canonicalName ?? createOp.slug,
          formalName:    props.formalName    ?? null,
          type:          props.type          ?? null,
          color:         props.color         ?? null,
          foundedDate:   props.foundedDate   ?? null,
          dissolvedDate: props.dissolvedDate ?? null,
          country:       props.country       ?? null,
        }
        live.savedSections.value = synthesizeSectionsFromModifyOps(payload)
      } else {
        await live.loadUnit(slug.value)
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
    live.resetUnit()
    _proposal.value.payload = null
    _proposal.value.error   = null
    _proposal.value.status  = 'pending'
  }

  return {
    ...live,
    loadUnit: loadPreview,
    resetUnit: reset,
    _proposal,
    accept,
    deny,
  }
}
