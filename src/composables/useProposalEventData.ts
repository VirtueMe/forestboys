/**
 * Proposal-preview wrapper for Operation + Incident. Shape mirrors
 * useProposalPersonData / useProposalUnitData / etc.
 *
 * The live `useEventData` is only used in proposal-preview today;
 * EventDetail.vue still owns its own fetch path. Once that page is
 * refactored to inject from EventDataKey, this composable swaps in
 * cleanly the same way Person/Unit do.
 */
import { ref, computed } from 'vue'
import { useEventData } from './useEventData.ts'
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

export function useProposalEventData(bundleId: string, entityId: string) {
  const live   = useEventData()
  const bundle = useProposalBundle(bundleId)

  const _proposal = ref<ProposalSidecar>({
    bundleId, entityId, status: 'pending', payload: null, loading: true, error: null,
  })

  const idMatch = entityId.match(/^(Operation|Incident):([a-z0-9-]+)$/)
  const slug    = computed(() => idMatch?.[2] ?? null)
  const kind    = idMatch?.[1].toLowerCase() === 'operation' ? 'operation' : 'incident'

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

      if (!slug.value) throw new Error(`useProposalEventData: ${entityId} is not an Operation/Incident id`)

      const createOp = payload.ops.find((o) => o.op === 'create-entity')
      if (createOp && createOp.op === 'create-entity') {
        const props = createOp.props as Partial<{ canonicalName: string; codeName: string; title: string; date: string | null }>
        live.event.value = {
          slug:          createOp.slug,
          kind,
          canonicalName: props.canonicalName ?? props.codeName ?? props.title ?? createOp.slug,
          date:          props.date ?? null,
        }
        live.savedSections.value = synthesizeSectionsFromModifyOps(payload)
      } else {
        await live.loadEvent(slug.value)
        applyModifyBlockOps(payload, live.savedSections.value)
        applyScalarOps(payload)
      }
    } catch (e) {
      _proposal.value.error = (e as Error).message
    } finally {
      _proposal.value.loading = false
    }
  }

  /** set-props (name, date) and set-kind on the previewed event — enough to see what changes. */
  function applyScalarOps(payload: EntityPayload): void {
    const ev = live.event.value
    if (!ev) return
    for (const op of payload.ops) {
      if (op.op === 'set-props') {
        for (const [prop, { to }] of Object.entries(op.props)) {
          if (prop === 'codeName' || prop === 'title') ev.canonicalName = typeof to === 'string' ? to : ev.canonicalName
          if (prop === 'date') ev.date = typeof to === 'string' ? to : null
        }
      }
      if (op.op === 'set-kind') ev.kind = op.to === 'Incident' ? 'incident' : 'operation'
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
    live.resetEvent()
    _proposal.value.payload = null
    _proposal.value.error   = null
    _proposal.value.status  = 'pending'
  }

  return {
    ...live,
    loadEvent:  loadPreview,
    resetEvent: reset,
    _proposal,
    accept,
    deny,
  }
}
