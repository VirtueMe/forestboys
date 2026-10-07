/**
 * Comparing a snapshot with the live graph: the ops of a review bundle (docs/BUNDLE-FORMAT.md, #159).
 *
 * A package says how entities should be. This says what would have to change for the graph to be so, as
 * the ops the bundle pipeline already knows (docs/PROPOSALS.md, *Op vocabulary*), so that an import is
 * reviewed and accepted like any other bundle and never written straight into the graph.
 *
 * Pure: the live state is given, not fetched. Matching a snapshot to a node (by source ref, else by slug)
 * is the caller's job, and it says whether the match is a link made by an earlier import.
 *
 * What the comparison does, and does not:
 *  - It only **adds and changes**. A property, description or edge that the live entity has and the snapshot
 *    does not mention stays: the receiving archive's own work is not removed by someone else's package.
 *    A property is removed by a snapshot value of `null`; edges of the types named in
 *    `authoritativeEdgeTypes` are made equal to the snapshot's (the caller's choice, for a snapshot that
 *    is the whole truth about them, as an outline's absorption is).
 *  - Only what the snapshot says is looked at, so the sync bridge's bookkeeping on the live node (never in a
 *    snapshot) cannot make a difference.
 *  - `set-description` is the op #161 adds to the bundle pipeline; until it is in, a bundle using it
 *    can be written and checked but not ingested.
 */

import {
  refOf,
  type BundlePackage, type DescriptionSnapshot, type EdgeSnapshot, type EntitySnapshot, type SourceRef,
} from './bundle-package.ts'
import { canonicalize, stableSha } from './stable-sha.ts'

/** What the receiving graph holds for an entity, as rows read from it. */
export interface LiveEntity {
  props:        Record<string, unknown>
  descriptions: DescriptionSnapshot[]
  edges:        EdgeSnapshot[]
}

export type DiffOp =
  | { op: 'create-entity'; kind: string; slug: string; props: Record<string, unknown>; edges: EdgeSnapshot[]; descriptions: DescriptionSnapshot[] }
  | { op: 'set-props'; props: Record<string, { from: unknown; to: unknown }> }
  | { op: 'set-description'; order: number; expectedSha: string; content: string }
  | { op: 'add-edge'; type: string; from: string; to: string; props?: Record<string, unknown> }
  | { op: 'remove-edge'; type: string; from: string; to: string }

export interface DiffOptions {
  /** Edge types the snapshot is the whole truth about: live edges of these types it lacks are removed. */
  authoritativeEdgeTypes?: string[]
}

const same = (a: unknown, b: unknown) => canonicalize(a ?? null) === canonicalize(b ?? null)

/** The Portable Text of a description as a value, so formatting of the JSON string does not count as a change. */
function blocksOf(content: string): unknown {
  try { return JSON.parse(content) } catch { return content }
}

/** The sha `set-description` carries as `expectedSha`: of the live blocks, or empty when there are none yet. */
export const descriptionSha = (content: string) => stableSha(blocksOf(content))

const edgeKey = (e: EdgeSnapshot) => `${e.type}|${e.to}`

/** The ops that make `live` hold `snapshot`. `live` null means the entity does not exist. Empty when nothing differs. */
export async function diffEntity(snapshot: EntitySnapshot, live: LiveEntity | null, options: DiffOptions = {}): Promise<DiffOp[]> {
  const ref = refOf(snapshot)

  if (!live) {
    return [{
      op: 'create-entity', kind: snapshot.kind, slug: snapshot.key,
      props: Object.fromEntries(Object.entries(snapshot.props).filter(([, v]) => v !== null)),
      edges: snapshot.edges, descriptions: snapshot.descriptions,
    }]
  }

  const have = live
  const ops: DiffOp[] = []

  // Properties: what the snapshot says and the live entity holds otherwise. A null removes.
  const changed: Record<string, { from: unknown; to: unknown }> = {}
  for (const [name, to] of Object.entries(snapshot.props)) {
    if (!same(have.props[name], to)) changed[name] = { from: have.props[name] ?? null, to }
  }
  if (Object.keys(changed).length) ops.push({ op: 'set-props', props: changed })

  // Descriptions, by order: a missing one is created, a different one replaced whole.
  const liveByOrder = new Map(have.descriptions.map(d => [d.order, d]))
  for (const d of snapshot.descriptions) {
    const there = liveByOrder.get(d.order)
    if (there && same(blocksOf(there.content), blocksOf(d.content))) continue
    ops.push({ op: 'set-description', order: d.order, expectedSha: there ? await descriptionSha(there.content) : '', content: d.content })
  }

  // Edges: a missing one is added, one with other properties is added again (the apply merges them).
  const liveEdges = new Map(have.edges.map(e => [edgeKey(e), e]))
  for (const e of snapshot.edges) {
    const there = liveEdges.get(edgeKey(e))
    const differs = !!e.props && Object.entries(e.props).some(([k, v]) => !same(there?.props?.[k], v))
    if (!there || differs) ops.push({ op: 'add-edge', type: e.type, from: ref, to: e.to, ...(e.props ? { props: e.props } : {}) })
  }
  const wanted = new Set(snapshot.edges.map(edgeKey))
  for (const e of have.edges) {
    if (options.authoritativeEdgeTypes?.includes(e.type) && !wanted.has(edgeKey(e))) {
      ops.push({ op: 'remove-edge', type: e.type, from: ref, to: e.to })
    }
  }

  return ops
}

/* ───────────────────────── a whole package ───────────────────────── */

/** What the caller found in the receiving graph for a snapshot. */
export interface Match {
  live:   LiveEntity | null
  /** True when the node was made by an earlier import from this source ref, false when it is the same slug by chance. */
  linked: boolean
}

export interface EntityDiff {
  /** `<Kind>:<key>`, the reviewable entity id of a bundle. */
  entityId: string
  ops:      DiffOp[]
  source:   SourceRef
  /** Set when the match is by slug alone: it is proposed as the same entity, for Jan or the admin to confirm. */
  note?:    string
}

export interface PackageDiff {
  /** Entities with something to change, in the package's order. */
  entities:  EntityDiff[]
  /** Entities that already hold what the package says. */
  unchanged: string[]
}

export async function diffPackage(
  pkg:     BundlePackage,
  resolve: (snapshot: EntitySnapshot) => Match | Promise<Match>,
  options: DiffOptions = {},
): Promise<PackageDiff> {
  const out: PackageDiff = { entities: [], unchanged: [] }
  for (const snapshot of pkg.entities) {
    const match = await resolve(snapshot)
    const ops = await diffEntity(snapshot, match.live, options)
    const entityId = refOf(snapshot)
    if (!ops.length) { out.unchanged.push(entityId); continue }
    out.entities.push({
      entityId, ops, source: snapshot.source,
      ...(match.live && !match.linked ? { note: `${entityId} exists here, but was not imported from ${snapshot.source.site}${snapshot.source.path}: proposed as the same entity` } : {}),
    })
  }
  return out
}
