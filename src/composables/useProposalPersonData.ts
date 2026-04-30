/**
 * useProposalPersonData — controller-view preview for a Person within a
 * proposal bundle.
 *
 * Wraps `usePersonData` and applies the bundle's ops on top, so
 * `PersonDetail.vue` can render the proposed state through the same
 * components it uses live. Returns the same reactive shape as
 * `usePersonData()` plus a `_proposal` sidecar:
 *
 *   - `manifest` / `payload` — the bundle slice that targets this entity
 *   - `status` — entity status from the manifest (`pending` typically)
 *   - `accept(expectedShas?, message?)` / `deny(reason)` — server actions
 *
 * Pass A scope (this file): applies `modify-block` ops only — the most
 * common case for editing existing entities. Edge ops (`add-edge`,
 * `remove-edge`) and full `create-entity` materialization land in
 * Pass B alongside RelationEntry pending-state fields and ghost-edge
 * styling.
 */
import { ref, computed } from 'vue'
import { usePersonData } from './usePersonData.ts'
import { useProposalBundle, type EntityStatus, type EntityPayload, type PtBlock } from './useProposalBundle.ts'
import type { Section } from '@/components/SectionsEditor.vue'

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

      const isCreate = payload.ops.some((o) => o.op === 'create-entity')
      if (!isCreate) {
        // Modify path: load live state first, then overlay modify-block ops.
        await live.loadPerson(slug.value)
        applyModifyBlockOps(payload, live.savedSections.value)
      } else {
        // TODO (Pass B): materialize a Person from create-entity props +
        // edges. For now we leave the live composable in its reset state;
        // the view will render the "ikke funnet" path until create-entity
        // support lands.
      }

      // TODO (Pass B): apply add-edge / remove-edge ops to the relation
      // entries arrays. Requires extending RelationEntry with optional
      // `pendingFromBundle` / `pendingRemoval` fields and corresponding
      // dashed-border styling on the relation chips.
    } catch (e) {
      _proposal.value.error = (e as Error).message
    } finally {
      _proposal.value.loading = false
    }
  }

  /** Compute expectedShas for every modify-block op in this entity's payload. */
  async function computeExpectedShas(): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    if (!_proposal.value.payload) return out
    for (const op of _proposal.value.payload.ops) {
      if (op.op !== 'modify-block') continue
      const block = findBlockInSections(live.savedSections.value, blockKeyFromPath(op.blockPath))
      out[op.blockPath] = block ? await stableShaBrowser(block) : ''
    }
    return out
  }

  async function accept(message: string | null = null) {
    const expectedShas = await computeExpectedShas()
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
    // Same shape as usePersonData() — components consume these unchanged.
    ...live,
    // Override load/reset so the page's DetailPage callbacks drive the
    // preview instead of the live composable directly.
    loadPerson: loadPreview,
    resetPerson: reset,
    // Proposal chrome
    _proposal,
    accept,
    deny,
  }
}

/* ────────────────────────── helpers ────────────────────────── */

const BLOCK_PATH_RE = /^section\.[a-z0-9-]+\.block\.([A-Za-z0-9_-]+)$/
function blockKeyFromPath(blockPath: string): string | null {
  const m = blockPath.match(BLOCK_PATH_RE)
  return m ? m[1] : null
}

function findBlockInSections(sections: Section[], key: string | null): PtBlock | null {
  if (!key) return null
  for (const s of sections) {
    try {
      const blocks = JSON.parse(s.content) as PtBlock[]
      const found  = blocks.find((b) => b?._key === key)
      if (found) return found
    } catch { /* skip malformed */ }
  }
  return null
}

/**
 * Replace the matching block within whichever section contains it, in
 * place on the same Section[] ref the page binds to. Mutates the array
 * so Vue reactivity flows; returns the count of replacements made.
 */
function applyModifyBlockOps(payload: EntityPayload, sections: Section[]): number {
  let replaced = 0
  for (const op of payload.ops) {
    if (op.op !== 'modify-block') continue
    const key = blockKeyFromPath(op.blockPath)
    if (!key) continue
    for (const section of sections) {
      try {
        const blocks = JSON.parse(section.content) as PtBlock[]
        const idx    = blocks.findIndex((b) => b?._key === key)
        if (idx !== -1) {
          blocks[idx] = op.newValue
          section.content = JSON.stringify(blocks)
          replaced++
          break
        }
      } catch { /* skip malformed */ }
    }
  }
  return replaced
}

/** sha256 of stable-key-ordered JSON, browser SubtleCrypto. */
async function stableShaBrowser(value: unknown): Promise<string> {
  const canonical = canonicalize(value)
  const bytes     = new TextEncoder().encode(canonical)
  const hashBuf   = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  const obj  = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}'
}
