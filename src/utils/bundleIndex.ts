/**
 * One summary row per bundle, and how the list asks it questions (#184). Pure, shared by the endpoint
 * (functions/_lib/bundle-index.ts) and the page. docs/PROPOSALS.md, «The list's index».
 *
 * The row is derived from the manifest, the comments and the time of the last change; it is kept in the custom metadata of one
 * small object per bundle, `proposals/index/<bundleId>.json`, so one listing returns the whole list with no manifest read. R2
 * has no queries: filtering, sorting and paging are done in the Worker over those rows.
 */

import { bundleCounts, bundleStatus, type BundleCounts, type BundleStatus } from './bundleStatus.ts'

export const INDEX_PREFIX = 'proposals/index/'
export const indexKey = (bundleId: string) => `${INDEX_PREFIX}${bundleId}.json`

export type OriginKind = 'outline' | 'package' | 'sanity'

export interface BundleRow {
  bundleId:   string
  summary:    string
  createdAt:  string
  /** When the bundle last changed (an accept, a comment, a resend…): what «most recently touched» sorts on. */
  updatedAt:  string
  status:     BundleStatus
  originKind: OriginKind
  /** "outline <slug>" / "package from …" / "Sanity <type>" */
  source:     string
  outlineId:  string | null
  model:      string
  counts:     BundleCounts
  entities:   number
  comments:   number
  /** The kinds of entity in the bundle («Unit», «Person»…), each once. */
  kinds:      string[]
  child:      boolean
}

export interface RowSource {
  bundleId: string; summary: string; createdAt: string; model: string; outlineId?: string; parentBundle?: string
  status?: BundleStatus
  entities: { entityId: string; status: string }[]
}

export function rowOf(m: RowSource, extra: { source: string; originKind: OriginKind; comments: number; updatedAt: string }): BundleRow {
  return {
    bundleId:   m.bundleId,
    summary:    m.summary,
    createdAt:  m.createdAt,
    updatedAt:  extra.updatedAt,
    status:     bundleStatus(m),
    originKind: extra.originKind,
    source:     extra.source,
    outlineId:  m.outlineId ?? null,
    model:      m.model,
    counts:     bundleCounts(m.entities),
    entities:   m.entities.length,
    comments:   extra.comments,
    kinds:      [...new Set(m.entities.map(e => e.entityId.split(':')[0]))].sort(),
    child:      !!m.parentBundle,
  }
}

/** R2's 2 KB of custom metadata, as strings: the long texts are cut, the whole bundle is in its own objects. */
export function toMetadata(r: BundleRow): Record<string, string> {
  const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
  return {
    bundleId:   r.bundleId,
    summary:    cut(r.summary, 300),
    createdAt:  r.createdAt,
    updatedAt:  r.updatedAt,
    status:     r.status,
    originKind: r.originKind,
    source:     cut(r.source, 120),
    ...(r.outlineId ? { outlineId: cut(r.outlineId, 80) } : {}),
    model:      cut(r.model, 60),
    counts:     [r.counts.pending, r.counts.accepted, r.counts.denied, r.counts.drifted].join(','),
    entities:   String(r.entities),
    comments:   String(r.comments),
    kinds:      cut(r.kinds.join(','), 200),
    child:      r.child ? '1' : '0',
  }
}

export function fromMetadata(m: Record<string, string> | undefined): BundleRow | null {
  if (!m?.bundleId || !m.createdAt) return null
  const [pending, accepted, denied, drifted] = (m.counts ?? '').split(',').map(n => Number(n) || 0)
  return {
    bundleId:   m.bundleId,
    summary:    m.summary ?? '',
    createdAt:  m.createdAt,
    updatedAt:  m.updatedAt ?? m.createdAt,
    status:     m.status === 'blocked' || m.status === 'closed' ? m.status : 'pending',
    originKind: m.originKind === 'outline' || m.originKind === 'package' ? m.originKind : 'sanity',
    source:     m.source ?? '',
    outlineId:  m.outlineId ?? null,
    model:      m.model ?? '',
    counts:     { pending: pending ?? 0, accepted: accepted ?? 0, denied: denied ?? 0, drifted: drifted ?? 0 },
    entities:   Number(m.entities) || 0,
    comments:   Number(m.comments) || 0,
    kinds:      m.kinds ? m.kinds.split(',') : [],
    child:      m.child === '1',
  }
}

/* ─────────────────────────── the question ─────────────────────────── */

export const PAGE_SIZES = [10, 20, 40] as const
export type StatusFilter = BundleStatus | 'all'
export type SortKey = 'newest' | 'oldest' | 'pending' | 'touched'

export interface ListQuery {
  /** The review queue by default: what still waits for a decision. */
  status:    StatusFilter
  origin:    OriginKind | 'all'
  kind:      string | null
  q:         string
  commented: boolean
  sort:      SortKey
  limit:     number
  offset:    number
}

export const DEFAULT_QUERY: ListQuery = { status: 'pending', origin: 'all', kind: null, q: '', commented: false, sort: 'newest', limit: 20, offset: 0 }

const one = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(v ?? '') ? v as T : fallback

/** A query from the URL's parameters: whatever is missing or wrong is the default, so a stale link still opens. */
export function parseQuery(p: URLSearchParams): ListQuery {
  const limit  = Number(p.get('limit'))
  const offset = Number(p.get('offset'))
  return {
    status:    one(p.get('status'), ['pending', 'blocked', 'closed', 'all'], DEFAULT_QUERY.status),
    origin:    one(p.get('origin'), ['outline', 'package', 'sanity', 'all'], 'all'),
    kind:      /^[A-Za-z]+$/.test(p.get('kind') ?? '') ? p.get('kind') : null,
    q:         (p.get('q') ?? '').trim().slice(0, 100),
    commented: p.get('commented') === '1',
    sort:      one(p.get('sort'), ['newest', 'oldest', 'pending', 'touched'], 'newest'),
    limit:     (PAGE_SIZES as readonly number[]).includes(limit) ? limit : DEFAULT_QUERY.limit,
    offset:    Number.isInteger(offset) && offset > 0 ? offset : 0,
  }
}

/** The parameters of a query: only what differs from the default, so a link stays short. */
export function toParams(q: ListQuery): URLSearchParams {
  const p = new URLSearchParams()
  if (q.status !== DEFAULT_QUERY.status) p.set('status', q.status)
  if (q.origin !== 'all')                p.set('origin', q.origin)
  if (q.kind)                            p.set('kind', q.kind)
  if (q.q)                               p.set('q', q.q)
  if (q.commented)                       p.set('commented', '1')
  if (q.sort !== DEFAULT_QUERY.sort)     p.set('sort', q.sort)
  if (q.limit !== DEFAULT_QUERY.limit)   p.set('limit', String(q.limit))
  if (q.offset)                          p.set('offset', String(q.offset))
  return p
}

export interface ListAnswer {
  bundles: BundleRow[]
  /** How many bundles match, before paging. */
  total:   number
  /** The whole list, by status, and the kinds there are: for the tabs and the menus. */
  facets:  { status: Record<StatusFilter, number>; kinds: string[] }
}

const sorters: Record<SortKey, (a: BundleRow, b: BundleRow) => number> = {
  newest:  (a, b) => b.createdAt.localeCompare(a.createdAt),
  oldest:  (a, b) => a.createdAt.localeCompare(b.createdAt),
  pending: (a, b) => b.counts.pending - a.counts.pending || b.createdAt.localeCompare(a.createdAt),
  touched: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
}

const norm = (t: string) => t.toLocaleLowerCase('nb')

/** Filter, sort and page the rows. The text finds the summary, the id, the origin and the outline; not the entity ids (see docs). */
export function queryRows(rows: readonly BundleRow[], q: ListQuery): ListAnswer {
  const status: Record<StatusFilter, number> = { pending: 0, blocked: 0, closed: 0, all: rows.length }
  const kinds = new Set<string>()
  for (const r of rows) { status[r.status]++; r.kinds.forEach(k => kinds.add(k)) }

  const needle = norm(q.q)
  const matching = rows
    .filter(r => q.status === 'all' || r.status === q.status)
    .filter(r => q.origin === 'all' || r.originKind === q.origin)
    .filter(r => !q.kind || r.kinds.includes(q.kind))
    .filter(r => !q.commented || r.comments > 0)
    .filter(r => !needle || [r.summary, r.bundleId, r.source, r.outlineId ?? ''].some(t => norm(t).includes(needle)))
    .sort(sorters[q.sort])

  return { bundles: matching.slice(q.offset, q.offset + q.limit), total: matching.length, facets: { status, kinds: [...kinds].sort() } }
}
