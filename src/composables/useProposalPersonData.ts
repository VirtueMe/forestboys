/**
 * useProposalPersonData — controller-view preview for a Person within a
 * proposal bundle.
 *
 * Wraps `usePersonData` and applies the bundle's ops on top, so
 * `PersonDetail.vue` can render the proposed state through the same
 * components it uses live. Returns the same reactive shape as
 * `usePersonData()` plus a `_proposal` sidecar.
 *
 * Pass A scope (this file): applies `modify-block` ops only.
 * Edge ops + create-entity materialization land in Pass B follow-ups
 * (see TODOs).
 */
import { ref, computed } from 'vue'
import { usePersonData } from './usePersonData.ts'
import { useProposalBundle, type EntityStatus, type EntityPayload } from './useProposalBundle.ts'
import { applyEdgeOps, applyModifyBlockOps, computeExpectedShas, type EdgeMap } from './proposalMerge.ts'

interface ProposalSidecar {
  bundleId: string
  entityId: string
  status:   EntityStatus
  payload:  EntityPayload | null
  loading:  boolean
  error:    string | null
}

export function useProposalPersonData(bundleId: string, entityId: string) {
  const live   = usePersonData()
  const bundle = useProposalBundle(bundleId)

  const _proposal = ref<ProposalSidecar>({
    bundleId,
    entityId,
    status:   'pending',
    payload:  null,
    loading:  true,
    error:    null,
  })

  /** Slug parsed from `Person:<slug>` — caller's responsibility to pass a Person id. */
  const slug = computed(() => {
    const m = entityId.match(/^Person:([a-z0-9-]+)$/)
    return m ? m[1] : null
  })

  async function loadPreview(): Promise<void> {
    _proposal.value.loading = true
    _proposal.value.error   = null

    try {
      await bundle.load()
      const ref     = bundle.getEntityRef(entityId)
      const payload = bundle.getEntityPayload(entityId)
      if (!ref || !payload) {
        throw new Error(`Entity ${entityId} not found in bundle ${bundleId}`)
      }
      _proposal.value.status  = ref.status
      _proposal.value.payload = payload

      if (!slug.value) throw new Error(`useProposalPersonData: ${entityId} is not a Person id`)

      const createOp = payload.ops.find((o) => o.op === 'create-entity')
      if (createOp && createOp.op === 'create-entity') {
        // Create-mode: no live state; build a skeleton Person from props.
        // Targets fetches are skipped (matches usePersonData('new') path),
        // so fabricated relation entries fall back to slug as targetName.
        const props = createOp.props as Partial<{
          canonicalName: string
          secretName:    string | null
          home:          string | null
          birthYear:     number | null
          status:        string | null
          serviceClass:  string | null
          type:          'civilian' | 'soldier'
        }>
        live.neo4jPerson.value = {
          slug:         createOp.slug,
          name:         props.canonicalName ?? createOp.slug,
          secretName:   props.secretName    ?? null,
          home:         props.home          ?? null,
          birthYear:    props.birthYear     ?? null,
          status:       props.status        ?? null,
          serviceClass: props.serviceClass  ?? null,
          type:         props.type          ?? 'civilian',
        }
        // Surface create-entity edges as ghost relation chips. No targets
        // list to resolve names from, so the chip shows the slug.
        const edgeMap: EdgeMap = {
          MEMBER_OF:       { entries: live.membershipEntries, targets: [], targetKind: 'Unit' },
          ATTENDED:        { entries: live.attendanceEntries, targets: [], targetKind: 'Unit' },
          INVOLVED_IN:     { entries: live.incidentEntries,   targets: [], targetKind: 'Incident' },
          PARTICIPATED_IN: { entries: live.operationEntries,  targets: [], targetKind: 'Operation' },
        }
        // Lift create-entity edges into add-edge ops so applyEdgeOps reuses
        // the same fabrication path. (We don't mutate the payload itself.)
        const synth: EntityPayload = {
          ...payload,
          ops: (createOp.edges ?? []).map((e) => ({
            op: 'add-edge' as const, type: e.type, from: entityId, to: e.to, props: e.props,
          })),
        }
        applyEdgeOps(synth, entityId, edgeMap, bundleId)
      } else {
        await live.loadPerson(slug.value)
        applyModifyBlockOps(payload, live.savedSections.value)
        const edgeMap: EdgeMap = {
          MEMBER_OF:       { entries: live.membershipEntries, targets: live.membershipTargets.value, targetKind: 'Unit' },
          ATTENDED:        { entries: live.attendanceEntries, targets: live.attendanceTargets.value, targetKind: 'Unit' },
          INVOLVED_IN:     { entries: live.incidentEntries,   targets: live.incidentTargets.value,   targetKind: 'Incident' },
          PARTICIPATED_IN: { entries: live.operationEntries,  targets: live.operationTargets.value,  targetKind: 'Operation' },
        }
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
    live.resetPerson()
    _proposal.value.payload = null
    _proposal.value.error   = null
    _proposal.value.status  = 'pending'
  }

  return {
    ...live,
    loadPerson: loadPreview,
    resetPerson: reset,
    _proposal,
    accept,
    deny,
  }
}
