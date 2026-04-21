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
  sections:       Section[]
  hasDescription: boolean
}

export interface RelationStrategy {
  fetchTargets(): Promise<RelationTarget[]>
  fetchEntries(parentSlug: string): Promise<RelationEntry[]>
  saveEntries(parentSlug: string, entries: RelationEntry[]): Promise<void>
  saveNote(parentSlug: string, targetSlug: string, sections: Section[]): Promise<void>
  targetRoute(entry: RelationEntry): string
}
