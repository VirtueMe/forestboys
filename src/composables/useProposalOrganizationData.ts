/**
 * Controller-view preview wrapper for Organization. See useProposalPersonData.
 *
 * Org's proposal-relevant edges all terminate at the Organization:
 * Unit-PART_OF→Org, Operation-ORCHESTRATED_BY→Org,
 * Incident-ORCHESTRATED_BY→Org. The bindings declare `direction: 'inbound'`
 * so applyEdgeOps matches `op.to === entityId`.
 */
import { ref, computed } from 'vue'
import { useOrganizationData } from './useOrganizationData.ts'
import { useProposalBundle, type EntityStatus, type EntityPayload } from './useProposalBundle.ts'
import { applyEdgeOps, applyModifyBlockOps, computeExpectedShas, synthesizeSectionsFromModifyOps, type EdgeMap } from './proposalMerge.ts'

interface ProposalSidecar {
  bundleId: string
  entityId: string
  status:   EntityStatus
  payload:  EntityPayload | null
  loading:  boolean
  error:    string | null
}

export function useProposalOrganizationData(bundleId: string, entityId: string) {
  const live   = useOrganizationData()
  const bundle = useProposalBundle(bundleId)

  const _proposal = ref<ProposalSidecar>({
    bundleId, entityId, status: 'pending', payload: null, loading: true, error: null,
  })

  const slug = computed(() => {
    const m = entityId.match(/^Organization:([a-z0-9-]+)$/)
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

      if (!slug.value) throw new Error(`useProposalOrganizationData: ${entityId} is not an Organization id`)

      const createOp = payload.ops.find((o) => o.op === 'create-entity')
      if (createOp && createOp.op === 'create-entity') {
        const props = createOp.props as Partial<{
          canonicalName: string
          formalName:    string | null
          abbreviation:  string | null
          sortingName:   string | null
          color:         string | null
          foundedDate:   string | null
          dissolvedDate: string | null
          country:       string | null
        }>
        live.org.value = {
          name:          props.canonicalName ?? createOp.slug,
          formalName:    props.formalName    ?? null,
          abbreviation:  props.abbreviation  ?? null,
          sortingName:   props.sortingName   ?? null,
          color:         props.color         ?? null,
          foundedDate:   props.foundedDate   ?? null,
          dissolvedDate: props.dissolvedDate ?? null,
          country:       props.country       ?? null,
        }
        live.savedSections.value = synthesizeSectionsFromModifyOps(payload)
        const edgeMap: EdgeMap = {
          PART_OF:         { entries: live.unitEntries,      targets: [], targetKind: 'Unit',      direction: 'inbound' },
          ORCHESTRATED_BY: { entries: live.operationEntries, targets: [], targetKind: 'Operation', direction: 'inbound' },
        }
        const synth: EntityPayload = {
          ...payload,
          ops: (createOp.edges ?? []).map((e) => ({
            op: 'add-edge' as const, type: e.type, from: entityId, to: e.to, props: e.props,
          })),
        }
        applyEdgeOps(synth, entityId, edgeMap, bundleId)
      } else {
        await live.loadOrg(slug.value)
        applyModifyBlockOps(payload, live.savedSections.value)
        const edgeMap: EdgeMap = {
          PART_OF:         { entries: live.unitEntries,      targets: live.unitTargets.value,      targetKind: 'Unit',      direction: 'inbound' },
          ORCHESTRATED_BY: { entries: live.operationEntries, targets: live.operationTargets.value, targetKind: 'Operation', direction: 'inbound' },
        }
        // ORCHESTRATED_BY edges from Incidents share the type key with
        // Operations; per-target-kind dispatch is deferred. Today the
        // binding lands the chip on the operation array regardless.
        applyEdgeOps(payload, entityId, edgeMap, bundleId)
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
    live.resetOrg()
    _proposal.value.payload = null
    _proposal.value.error   = null
    _proposal.value.status  = 'pending'
  }

  return {
    ...live,
    loadOrg: loadPreview,
    resetOrg: reset,
    _proposal,
    accept,
    deny,
  }
}
