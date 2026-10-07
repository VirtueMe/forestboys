/**
 * Shared pure helpers used by the per-kind proposal-preview composables
 * (`useProposalPersonData`, `useProposalUnitData`, …).
 *
 * Everything here is side-effect-free except `applyModifyBlockOps`,
 * which mutates the Section[] array in place so Vue's reactivity flows
 * to bound components.
 */
import type { EntityPayload, PtBlock } from './useProposalBundle.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'

const BLOCK_PATH_RE = /^section\.[a-z0-9-]+\.block\.([A-Za-z0-9_-]+)$/

export function blockKeyFromPath(blockPath: string): string | null {
  const m = blockPath.match(BLOCK_PATH_RE)
  return m ? m[1] : null
}

/** Locate a PT block by `_key` across every section. Returns null if none. */
export function findBlockInSections(sections: Section[], key: string | null): PtBlock | null {
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

const SECTION_PATH_RE = /^section\.([a-z0-9-]+)\.block\.[A-Za-z0-9_-]+$/

/**
 * Build Section[] for a freshly-created entity's preview.
 *
 * Preferred path: read `createOp.descriptions[]` (the schema-correct
 * carrier for initial body) and map directly to Section[].
 *
 * Fallback path: if no descriptions are present but the bundle has
 * `modify-block` ops on the new entity (older malformed bot output),
 * synthesize Section[] by grouping those blocks under the section slug
 * parsed from each blockPath. Keeps stale-bundle previews useful.
 */
export function synthesizeSectionsFromModifyOps(payload: EntityPayload): Section[] {
  const createOp = payload.ops.find((o) => o.op === 'create-entity')
  if (createOp && createOp.op === 'create-entity' && createOp.descriptions?.length) {
    return createOp.descriptions.map((d): Section => ({
      order:       d.order,
      content:     d.content,
      citations:   [],
      sourcedFrom: null,
    }))
  }
  const bySection = new Map<string, PtBlock[]>()
  for (const op of payload.ops) {
    if (op.op !== 'modify-block') continue
    const m = op.blockPath.match(SECTION_PATH_RE)
    if (!m) continue
    const slug = m[1]
    if (!bySection.has(slug)) bySection.set(slug, [])
    bySection.get(slug)!.push(op.newValue)
  }
  let order = 1
  return [...bySection.values()].map((blocks): Section => ({
    order:       order++,
    content:     JSON.stringify(blocks),
    citations:   [],
    sourcedFrom: null,
  }))
}

/**
 * Apply the payload's text ops in place across the Section[] ref the page binds to: each `modify-block`
 * replaces its matching block, each `set-description` replaces the whole text of the section with that
 * order, or adds the section when there is none (#161). Returns the count of changes.
 */
export function applyModifyBlockOps(payload: EntityPayload, sections: Section[]): number {
  let replaced = 0
  for (const op of payload.ops) {
    if (op.op === 'set-description') {
      const section = sections.find((s) => s.order === op.order)
      if (section) section.content = op.content
      else sections.push({ order: op.order, content: op.content, citations: [], sourcedFrom: null })
      replaced++
      continue
    }
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

/**
 * Compute `expectedShas` for every modify-block op in the payload by
 * hashing the live section blocks Jan saw at decision time. Caller
 * passes this to the accept endpoint; server recomputes against
 * post-decision live state and rejects on mismatch.
 */
export async function computeExpectedShas(
  payload:  EntityPayload | null,
  sections: Section[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!payload) return out
  for (const op of payload.ops) {
    if (op.op !== 'modify-block') continue
    const block = findBlockInSections(sections, blockKeyFromPath(op.blockPath))
    out[op.blockPath] = block ? await stableShaBrowser(block) : ''
  }
  return out
}

/**
 * Per-edge-type binding for `applyEdgeOps`. The wrapper composable
 * supplies one entry per relation array it owns, keyed by the Neo4j
 * edge type the strategy reads.
 *
 * `targets` is used to resolve `targetName` for fabricated entries
 * (an `add-edge` op only carries the target's `Kind:slug` id; the
 * human-readable name comes from the live targets list the strategy
 * fetched). If a target isn't in the list (e.g. it's another bundle
 * entity not yet in Neo4j), we fall back to the slug as the name —
 * the chip will look ghost.
 *
 * `direction` selects which end of the edge this binding represents
 * relative to the entity being previewed. `outbound` (the default) is
 * for entities where the edge originates (Person-MEMBER_OF→Unit on
 * the Person preview). `inbound` is for entities where the edge
 * terminates (Unit-PART_OF→Org on the Org preview — the binding
 * targets the Unit ends).
 */
export interface EdgeBinding {
  entries: { value: RelationEntry[] }   // ref-like — composables pass the .value carrier
  targets: RelationTarget[]
  /** Slug of the target ref shape we expect (e.g. "Unit", "Operation"). */
  targetKind: string
  direction?: 'outbound' | 'inbound'
}

export type EdgeMap = Record<string, EdgeBinding>

/**
 * Apply `add-edge` / `remove-edge` ops to the relation arrays owned by
 * the wrapper composable. Each binding declares whether its edges are
 * outbound (default — match `op.from === entityId`) or inbound
 * (match `op.to === entityId`). Returns counts for diagnostics.
 *
 * Mutates the `.value` arrays in place so Vue reactivity flows.
 */
export function applyEdgeOps(
  payload:  EntityPayload,
  entityId: string,
  edgeMap:  EdgeMap,
  bundleId: string,
): { added: number; removed: number; skipped: number } {
  let added = 0, removed = 0, skipped = 0

  for (const op of payload.ops) {
    if (op.op !== 'add-edge' && op.op !== 'remove-edge') continue

    const binding = edgeMap[op.type]
    if (!binding) { skipped++; continue }

    const inbound = binding.direction === 'inbound'
    const localEnd  = inbound ? op.to   : op.from
    const targetEnd = inbound ? op.from : op.to
    if (localEnd !== entityId) { skipped++; continue }

    const targetSlug = targetEnd.slice(targetEnd.indexOf(':') + 1)

    if (op.op === 'remove-edge') {
      for (const entry of binding.entries.value) {
        if (entry.targetSlug === targetSlug) {
          entry.pendingRemoval = true
          removed++
        }
      }
      continue
    }

    // add-edge: fabricate a RelationEntry stub. The detail components
    // care about targetSlug + targetName + (optionally) role/dates;
    // anything else stays default.
    const targetName = binding.targets.find((t) => t.slug === targetSlug)?.name ?? targetSlug
    const propsRaw = op.props ?? {}
    binding.entries.value.push({
      targetSlug,
      targetName,
      startDate:        typeof propsRaw.startDate === 'string' ? propsRaw.startDate : null,
      endDate:          typeof propsRaw.endDate   === 'string' ? propsRaw.endDate   : null,
      role:             typeof propsRaw.role      === 'string' ? propsRaw.role      : null,
      sections:         [],
      hasDescription:   false,
      pendingFromBundle: bundleId,
    })
    added++
  }

  return { added, removed, skipped }
}

/** sha256 of stable-key-ordered JSON, browser SubtleCrypto. */
export async function stableShaBrowser(value: unknown): Promise<string> {
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
