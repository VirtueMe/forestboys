/**
 * Strategy interface for "relation sections" on a detail page.
 *
 * The strategy is intentionally narrow: it knows how to fetch possible
 * targets, fetch/save entries for a person, and build the URL a preview
 * row links to. Visual config (labels, placeholders, role visibility) is
 * passed as component props.
 */

import type { Section } from '@/components/SectionsEditor.vue'

export interface RelationTarget {
  slug: string
  name: string
  /** Other names (a station's former names etc.): the picker matches on these too. */
  aliases?: string[]
}

export interface RelationEntry {
  targetSlug:     string
  targetName:     string
  startDate:      string | null
  endDate:        string | null
  /** Only populated when the strategy exposes roles. */
  role?:          string | null
  /** Only populated when the strategy exposes a pass/fail flag (courses). */
  passed?:        boolean | null
  /** Edge sort order — lower appears first. Only populated when the strategy
   *  exposes order (e.g. PART_OF with curated org/unit ordering). */
  order?:         number | null
  sections:       Section[]
  hasDescription: boolean
  /**
   * Stable id of the edge, for relations that allow several edges to the
   * same target (STATIONED_AT: several stays at one place). When set, the
   * editor keys notes by it instead of by target. saveEntries fills it in
   * for new rows.
   */
  edgeId?:        string | null
  /** Claim state of the edge ('candidate' = migrated, not yet reviewed). */
  state?:         string | null
  /** Rank history only: held in an acting capacity (docs/PERSON-RANKS.md). */
  acting?:        boolean
  /** Evidence for the edge's claim — SourceRef strings (`<source-id>#page:47`),
   *  distinct from the note's citations. Only relations with `show-sources`. */
  sourceRefs?:    string[]
  /**
   * Proposal-preview sidecar (live consumers ignore both):
   *   - `pendingFromBundle` — set on entries fabricated from an `add-edge`
   *     op; the value is the bundle id so the chip can deep-link to the
   *     bundle review.
   *   - `pendingRemoval` — true on a live entry that an in-flight bundle's
   *     `remove-edge` op would drop on accept.
   * Render styling lives on the relation chip components.
   */
  pendingFromBundle?: string | null
  pendingRemoval?:    boolean
}

export interface RelationStrategy {
  fetchTargets(): Promise<RelationTarget[]>
  fetchEntries(parentSlug: string): Promise<RelationEntry[]>
  saveEntries(parentSlug: string, entries: RelationEntry[]): Promise<void>
  /** `noteKey` is the entry's edgeId when the strategy uses edge ids, else its targetSlug. */
  saveNote(parentSlug: string, noteKey: string, sections: Section[]): Promise<void>
  targetRoute(entry: RelationEntry): string
}
