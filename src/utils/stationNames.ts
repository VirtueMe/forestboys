/**
 * Display and search helpers for a station's other names
 * (`(:Station)-[:HAS_NAME]->(:Name)`, docs/SCHEMA.md).
 */
import { comparePartial } from './period.ts'

export type NameType = 'former' | 'later' | 'alias'

export const NAME_TYPE_LABEL: Record<NameType, string> = {
  former: 'Tidligere navn',
  later:  'Senere navn',
  alias:  'Annet navn',
}

/** Short labels for the one-line summary under the station title. */
export const NAME_TYPE_SHORT: Record<NameType, string> = {
  former: 'Tidligere',
  later:  'Senere',
  alias:  'Også kjent som',
}

export interface NameLike {
  value:      string
  type:       NameType
  from:       string | null
  fromAbout:  boolean
  to:         string | null
  toAbout:    boolean
}

/**
 * "1943 – 1945", "ca. 1943 –", "– ca. 1945"; '' when there are no dates.
 * An empty end is open (unknown or still in use), never "the same day".
 */
export function formatNamePeriod(n: Pick<NameLike, 'from' | 'fromAbout' | 'to' | 'toAbout'>): string {
  if (!n.from && !n.to) return ''
  const from = n.from ? `${n.fromAbout ? 'ca. ' : ''}${n.from}` : '?'
  const to   = n.to   ? ` ${n.toAbout ? 'ca. ' : ''}${n.to}` : ''
  return `${from} –${to}`
}

const TYPE_ORDER: Record<NameType, number> = { former: 0, later: 1, alias: 2 }

/** Former names first, then later ones, then aliases; by start date within a type, undated last. */
export function sortNames<T extends NameLike>(names: T[]): T[] {
  return [...names].sort((a, b) => {
    if (a.type !== b.type) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
    if (a.from && b.from) return comparePartial(a.from, b.from) || a.value.localeCompare(b.value, 'nb')
    if (a.from) return -1
    if (b.from) return 1
    return a.value.localeCompare(b.value, 'nb')
  })
}

/** The first name containing `query` (case-insensitive), or null. */
export function matchingName(query: string, names: readonly string[] | null | undefined): string | null {
  const q = query.trim().toLowerCase()
  if (!q || !names) return null
  return names.find(n => n.toLowerCase().includes(q)) ?? null
}

/**
 * The other name to show next to a hit that matched on it: null when the
 * title matched itself (or nothing did), so the row stays clean.
 */
export function aliasHint(query: string, title: string, names: readonly string[] | null | undefined): string | null {
  const q = query.trim().toLowerCase()
  if (!q || title.toLowerCase().includes(q)) return null
  return matchingName(q, names)
}
