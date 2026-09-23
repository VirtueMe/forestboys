/**
 * usePendingDescription — module-level handoff for "description couldn't
 * save during create" recovery.
 *
 * Flow:
 *   1. Create form POSTs the entity → entity exists at <kind>/<slug>.
 *   2. Same page tries to PATCH /api/admin/<kind>/<slug>/sections with
 *      the user's description draft.
 *   3. On PATCH failure we still navigate to /<kind>/<slug> (the entity
 *      exists), but we `stash()` the failing draft + error so the
 *      destination detail page can pick it up on next mount and let the
 *      user retry without losing work.
 *
 * The destination page calls `consume(kind, slug)`: a one-shot read that
 * clears the stash if the kind/slug match. Mismatches (or no pending)
 * return null, leaving the stash for the right destination if it ever
 * arrives.
 */
import { ref } from 'vue'
import type { Section } from '@/components/SectionsEditor.vue'

export type PendingKind = 'organization' | 'person' | 'unit' | 'station' | 'location' | 'transport'

export interface PendingDescription {
  kind:     PendingKind
  slug:     string
  sections: Section[]
  error:    string
}

const pending = ref<PendingDescription | null>(null)

export function stashPendingDescription(p: PendingDescription): void {
  pending.value = p
}

export function consumePendingDescription(kind: PendingKind, slug: string): PendingDescription | null {
  const v = pending.value
  if (v && v.kind === kind && v.slug === slug) {
    pending.value = null
    return v
  }
  return null
}
