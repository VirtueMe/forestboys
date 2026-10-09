/**
 * The entities of one bundle, filtered and paged in the browser (#184): the biggest bundle of #158 has 287 of them, and the
 * review is one entity at a time. The manifest carries all of them already, so this needs no server. Pure.
 */

import { PAGE_SIZES } from './bundleIndex.ts'

export type EntityStatusFilter = 'pending' | 'accepted' | 'denied' | 'drifted' | 'all'

export interface EntityFilter {
  /** `auto`: what still waits if anything does, else all: so the page opens on the next thing to decide. */
  status: EntityStatusFilter | 'auto'
  kind:   string | null
  q:      string
  limit:  number
  offset: number
}

export const DEFAULT_ENTITY_FILTER: EntityFilter = { status: 'auto', kind: null, q: '', limit: PAGE_SIZES[1], offset: 0 }

/** Below this many entities the bar is not shown: there is nothing to find or to page. */
export const FILTER_FROM = 10

export interface EntityRow { entityId: string; status: string }

export interface EntityPage<T extends EntityRow> {
  rows:    T[]
  total:   number
  status:  EntityStatusFilter
  counts:  Record<EntityStatusFilter, number>
  kinds:   string[]
}

export function filterEntities<T extends EntityRow>(entities: readonly T[], f: EntityFilter): EntityPage<T> {
  const counts: Record<EntityStatusFilter, number> = { pending: 0, accepted: 0, denied: 0, drifted: 0, all: entities.length }
  const kinds = new Set<string>()
  for (const e of entities) {
    if (e.status in counts) counts[e.status as EntityStatusFilter]++
    kinds.add(e.entityId.split(':')[0])
  }
  const status: EntityStatusFilter = f.status === 'auto' ? (counts.pending ? 'pending' : 'all') : f.status
  const needle = f.q.trim().toLocaleLowerCase('nb')
  const matching = entities
    .filter(e => status === 'all' || e.status === status)
    .filter(e => !f.kind || e.entityId.startsWith(`${f.kind}:`))
    .filter(e => !needle || e.entityId.toLocaleLowerCase('nb').includes(needle))
  return { rows: matching.slice(f.offset, f.offset + f.limit), total: matching.length, status, counts, kinds: [...kinds].sort() }
}
