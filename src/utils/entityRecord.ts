/**
 * One record per entity and bundle (#273): `proposals/by-entity/<entityId>/<bundleId>.json`. Pure, shared by the endpoints
 * (functions/_lib/entity-records.ts) and the page. docs/PROPOSALS.md, «Entity records».
 *
 * The record is derived from the bundle's ops: what they touch is kept in the custom metadata of one small object, so one
 * listing of an entity's prefix answers the marker badge and «the other bundles that touch this entity» with no body read.
 */

export const ENTITY_RECORD_PREFIX = 'proposals/by-entity/'
export const entityPrefix = (entityId: string) => `${ENTITY_RECORD_PREFIX}${entityId}/`
export const recordKey   = (entityId: string, bundleId: string) => `${entityPrefix(entityId)}${bundleId}.json`
export const payloadKey  = (entityId: string, bundleId: string) => `proposals/bundles/${bundleId}/entity/${entityId}.json`

/** A key under an entity's prefix that is a record: not the old shared `index.json`, which is gone once the readers switch. */
export function bundleIdOfKey(entityId: string, key: string): string | null {
  const prefix = entityPrefix(entityId)
  if (!key.startsWith(prefix) || !key.endsWith('.json')) return null
  const id = key.slice(prefix.length, -'.json'.length)
  return id === 'index' || id.includes('/') ? null : id
}

/** When the bundle was made: the ISO timestamp is the end of the id, `bundle:<channel>:<isoTimestamp>`. */
export const createdAtOf = (bundleId: string) => bundleId.split(':').slice(2).join(':')

/** Newest bundle first: by the time in the id, not by the channel that comes before it. */
export const newestFirst = (a: { bundleId: string }, b: { bundleId: string }) =>
  createdAtOf(b.bundleId).localeCompare(createdAtOf(a.bundleId)) || b.bundleId.localeCompare(a.bundleId)

export type EntityRecordStatus = 'pending' | 'accepted' | 'denied' | 'drifted' | 'archived'
const STATUSES: readonly string[] = ['pending', 'accepted', 'denied', 'drifted', 'archived']

export interface EntityRecord {
  bundleId: string
  entityId: string
  status:   EntityRecordStatus
  /** Properties the ops set, from `set-props` and `create-entity`. */
  props:    string[]
  /** Descriptions the ops touch: `description:<order>`, or a `blockPath`. */
  blocks:   string[]
  /** Edges the ops add or remove, as `<type>:<to>`. */
  edges:    string[]
  /** The op kinds, each once. */
  ops:      string[]
  /** A list was cut to fit the metadata: the overlap with another record can then not be ruled out. */
  truncated: boolean
}

/** The part of an op this reads; the full types are in functions/_lib/bundle-validate.ts. */
export interface OpLike {
  op:           string
  props?:       Record<string, unknown>
  edges?:       { type: string; to: string }[]
  descriptions?: { order: number }[]
  blockPath?:   string
  order?:       number
  type?:        string
  to?:          string
}

const sorted = (s: Set<string>) => [...s].sort()

export function summarizeOps(ops: readonly OpLike[]): Pick<EntityRecord, 'props' | 'blocks' | 'edges' | 'ops'> {
  const props = new Set<string>(), blocks = new Set<string>(), edges = new Set<string>(), kinds = new Set<string>()
  for (const o of ops) {
    kinds.add(o.op)
    if (o.op === 'set-props' || o.op === 'create-entity') for (const k of Object.keys(o.props ?? {})) props.add(k)
    if (o.op === 'create-entity') {
      for (const e of o.edges ?? []) edges.add(`${e.type}:${e.to}`)
      for (const d of o.descriptions ?? []) blocks.add(`description:${d.order}`)
    }
    if (o.op === 'set-description' && o.order !== undefined) blocks.add(`description:${o.order}`)
    if (o.op === 'modify-block' && o.blockPath) blocks.add(o.blockPath)
    if ((o.op === 'add-edge' || o.op === 'remove-edge') && o.type && o.to) edges.add(`${o.type}:${o.to}`)
  }
  return { props: sorted(props), blocks: sorted(blocks), edges: sorted(edges), ops: sorted(kinds) }
}

export function recordOf(bundleId: string, entityId: string, status: EntityRecordStatus, ops: readonly OpLike[]): EntityRecord {
  return { bundleId, entityId, status, ...summarizeOps(ops), truncated: false }
}

/** What the record's body holds: where the payload is, never a copy of the ops. */
export const bodyOf = (r: Pick<EntityRecord, 'bundleId' | 'entityId'>) =>
  ({ bundleId: r.bundleId, entityId: r.entityId, payload: payloadKey(r.entityId, r.bundleId) })

/** Per list, so one long list cannot take the room of the others; the whole stays well under R2's 2 KB. */
const LIST_BUDGET = 450

function cutList(items: string[]): { text: string; cut: boolean } {
  const out: string[] = []
  let size = 0
  for (const item of items) {
    if (size + item.length + 1 > LIST_BUDGET) return { text: `${out.join(',')},…`, cut: true }
    out.push(item); size += item.length + 1
  }
  return { text: out.join(','), cut: false }
}

export function toMetadata(r: EntityRecord): Record<string, string> {
  const props = cutList(r.props), blocks = cutList(r.blocks), edges = cutList(r.edges)
  return {
    status: r.status,
    props:  props.text,
    blocks: blocks.text,
    edges:  edges.text,
    ops:    r.ops.join(','),
    ...(r.truncated || props.cut || blocks.cut || edges.cut ? { truncated: '1' } : {}),
  }
}

const split = (s: string | undefined) => (s ? s.split(',').filter(x => x && x !== '…') : [])

/** The record a listing gives: the ids come from the key, the rest from the metadata. Null for an object that is not one. */
export function fromMetadata(entityId: string, key: string, m: Record<string, string> | undefined): EntityRecord | null {
  const bundleId = bundleIdOfKey(entityId, key)
  if (!bundleId || !m || !STATUSES.includes(m.status)) return null
  return {
    bundleId, entityId,
    status:    m.status as EntityRecordStatus,
    props:     split(m.props),
    blocks:    split(m.blocks),
    edges:     split(m.edges),
    ops:       split(m.ops),
    truncated: m.truncated === '1',
  }
}

/** What two records of one entity both change: the shared entries, `entity` when one of them replaces or removes the whole. */
export function sharedChanges(a: EntityRecord, b: EntityRecord): string[] {
  const whole = (r: EntityRecord) => r.ops.includes('delete-entity') || r.ops.includes('set-kind')
  const out: string[] = []
  if (whole(a) || whole(b) || (a.ops.includes('create-entity') && b.ops.includes('create-entity'))) out.push('entity')
  for (const [x, y] of [[a.props, b.props], [a.blocks, b.blocks], [a.edges, b.edges]] as const) {
    for (const item of x) if (y.includes(item)) out.push(item)
  }
  return out
}

/** Two pending bundles that change the same thing: what the page flags. A cut list cannot rule an overlap out, so it counts. */
export function conflicts(a: EntityRecord, b: EntityRecord): boolean {
  if (a.status !== 'pending' || b.status !== 'pending' || a.bundleId === b.bundleId) return false
  return a.truncated || b.truncated || sharedChanges(a, b).length > 0
}

/** Another bundle that touches the same entity, as the bundle page shows it. */
export interface RelatedBundle {
  bundleId:  string
  createdAt: string
  status:    EntityRecordStatus
  props:     string[]
  blocks:    string[]
  edges:     string[]
  ops:       string[]
  /** What it changes that this bundle changes too, when both still wait; empty otherwise. */
  shared:    string[]
}

/** The other bundles in `records` (all of one entity) as seen from `bundleId`, newest first. */
export function relatedFor(bundleId: string, records: readonly EntityRecord[]): RelatedBundle[] {
  const mine = records.find(r => r.bundleId === bundleId)
  return records
    .filter(r => r.bundleId !== bundleId)
    .map(r => ({
      bundleId: r.bundleId, createdAt: createdAtOf(r.bundleId), status: r.status,
      props: r.props, blocks: r.blocks, edges: r.edges, ops: r.ops,
      shared: mine && conflicts(mine, r) ? (sharedChanges(mine, r).length ? sharedChanges(mine, r) : ['?']) : [],
    }))
    .sort(newestFirst)
}

export const recordStatusLabel: Record<EntityRecordStatus, string> = {
  pending: 'Venter', accepted: 'Godkjent', denied: 'Avvist', drifted: 'Satt til side', archived: 'Arkivert',
}
