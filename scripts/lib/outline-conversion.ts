/**
 * What earlier outline absorptions left in the graph, turned into bundles for Jan to accept (#158).
 *
 * The nodes were made from outlines by us, not accepted by Jan as bundles. Each carries `sanityOutlineId`, the
 * only link to its outline, used here once to group them. A group is one outline, the entity made from it, its
 * description(s) and the edges that leave it (they travel with the entity) and arrive at it from other entities
 * (they are the other entity's, so they become `add-edge` ops on it).
 *
 * The decisions are pure and tested; only `readConversion` and `removeConverted` talk to the graph. Nothing here
 * writes a Sanity id or `_rev` into a bundle or the package.
 */

import type { Session } from 'neo4j-driver'
import { keyProp, parseNodeRef } from '../../functions/_lib/entity-ref.ts'
import {
  entityPath, isBridgeProp, makeEntitySnapshot, makePackage, refOf, stripBridgeProps, type BundlePackage, type DescriptionSnapshot, type EdgeSnapshot, type EntitySnapshot,
} from '../../functions/_lib/bundle-package.ts'
import { canonicalize } from '../../functions/_lib/stable-sha.ts'
import { outlineContentSha } from '../../functions/_lib/outline-sha.ts'
import { validateBundle } from '../../functions/_lib/bundle-validate.ts'
import { edgeTarget, KNOWN_KINDS } from './package-graph.ts'

/** An edge from another entity into the converted one. It belongs to `from`, so it is an op on that entity. */
export interface InboundEdge { from: string; type: string; to: string; props?: Record<string, unknown> }

export interface OutlineGroup {
  /** The slug of the outline the entity was made from: the bundle's `outlineId`. */
  outlineSlug: string
  /** The hash of the outline's text now: the bundle's `outlineRev`. */
  outlineSha:  string
  entity:      EntitySnapshot
  inbound:     InboundEdge[]
}

/**
 * An edge that does not become an op, and why. It goes with the removal and stays in the archive.
 *  - `not-entity`  the other end is no entity (a Description of a membership note)
 *  - `bad-slug`    the other end's slug is not a slug (a trailing space), so a bundle cannot name it: re-add it from the archive once it is
 *  - `not-ours`    a person's `MEMBER_OF` without the import's `sourceRef`: neither the import nor we made it (decided in #158: dropped without a word to Jan)
 */
export interface Unlinked { from: string; type: string; to: string; reason: 'not-entity' | 'bad-slug' | 'not-ours' }

export interface RawNode { key: string; labels: string[]; props: Record<string, unknown> }
export interface RawEdge { type: string; from: string; to: string; props: Record<string, unknown> }

/** Everything needed to put the nodes back: the nodes with all their properties and every edge that touches them. */
export interface RawArchive { nodes: RawNode[]; edges: RawEdge[] }

export interface Conversion {
  groups:   OutlineGroup[]
  unlinked: Unlinked[]
  raw:      RawArchive
}

const stripEdgeProps = (props: Record<string, unknown>): Record<string, unknown> | undefined => {
  const kept = stripBridgeProps(props).kept
  return Object.keys(kept).length ? kept : undefined
}

/* ───────────────────────── the bundle of one outline ───────────────────────── */

type CreateOp = { op: 'create-entity'; kind: string; slug: string; props: Record<string, unknown>; edges: EdgeSnapshot[]; descriptions: DescriptionSnapshot[] }
type AddEdgeOp = { op: 'add-edge'; type: string; from: string; to: string; props?: Record<string, unknown> }
export interface OutlineBundleEntity {
  entityId: string; ops: (CreateOp | AddEdgeOp)[]
  derivedFrom: { outlineId: string; outlineRev: string }; source: string; generatedAt: string
}
export interface OutlineBundleBody {
  bundleId: string; outlineId: string; outlineRev: string; summary: string; createdAt: string
  model: 'none'; promptHash: 'none'; entities: OutlineBundleEntity[]
}

/**
 * The bundle for one outline: the entity made from it, and an `add-edge` entity for every other entity that
 * pointed into it. An outline bundle (`outlineId` + `outlineRev`) so the nodes it creates carry `originOutline` and
 * `originSha` from the first accept (#157). `model` and `promptHash` say it was not made by the bot.
 */
export function buildOutlineBundle(group: OutlineGroup, now: string): OutlineBundleBody {
  const ref = refOf(group.entity)
  const derivedFrom = { outlineId: group.outlineSlug, outlineRev: group.outlineSha }
  const source = `absorption:outline:${group.outlineSlug}`
  const e = group.entity

  const byFrom = new Map<string, InboundEdge[]>()
  for (const edge of group.inbound) byFrom.set(edge.from, [...(byFrom.get(edge.from) ?? []), edge])

  const entities: OutlineBundleEntity[] = [
    {
      entityId: ref,
      ops: [{ op: 'create-entity' as const, kind: e.kind, slug: e.key, props: e.props, edges: e.edges, descriptions: e.descriptions }],
      derivedFrom, source, generatedAt: now,
    },
    ...[...byFrom].sort(([a], [b]) => a.localeCompare(b)).map(([from, edges]) => ({
      entityId: from,
      ops: edges.map(i => ({ op: 'add-edge' as const, type: i.type, from, to: i.to, ...(i.props ? { props: i.props } : {}) })),
      derivedFrom, source, generatedAt: now,
    })),
  ]
  const inbound = group.inbound.length
  return {
    bundleId:   `bundle:${group.outlineSlug}:${now}`,
    outlineId:  group.outlineSlug,
    outlineRev: group.outlineSha,
    summary:    `Earlier absorption of outline ${group.outlineSlug}, made before it was a bundle: ${ref}${inbound ? ` and ${inbound} edge${inbound === 1 ? '' : 's'} into it from ${byFrom.size} other ${byFrom.size === 1 ? 'entity' : 'entities'}` : ''}.`,
    createdAt:  now,
    model:      'none',
    promptHash: 'none',
    entities,
  }
}

/* ───────────────────────── the archive ───────────────────────── */

export interface ConversionArchive {
  madeAt:  string
  /** The entities as a package of snapshots (docs/BUNDLE-FORMAT.md): no Sanity metadata. */
  package: BundlePackage
  /** Per outline: its slug, the hash of its text and the entity made from it. */
  outlines: { outlineSlug: string; outlineSha: string; entity: string }[]
  /** The edges into the entities, which a snapshot does not hold. */
  inbound: InboundEdge[]
  /** What it takes to put the nodes back as they were, bookkeeping included. */
  raw:     RawArchive
  unlinked: Unlinked[]
}

export function buildArchive(c: Conversion, site: string, madeAt: string): ConversionArchive {
  return {
    madeAt,
    package:  makePackage({ site, madeAt, filter: 'nodes made from outlines before they were bundles (#158)' }, c.groups.map(g => g.entity)),
    outlines: c.groups.map(g => ({ outlineSlug: g.outlineSlug, outlineSha: g.outlineSha, entity: refOf(g.entity) })).sort((a, b) => a.outlineSlug.localeCompare(b.outlineSlug)),
    inbound:  c.groups.flatMap(g => g.inbound),
    raw:      c.raw,
    unlinked: c.unlinked,
  }
}

/**
 * Every way the bundles fail to hold what the nodes had, checked against the archive: an empty list when they do.
 * Each bundle must pass what ingest checks, and carry the entity's props, descriptions, edges and inbound edges whole.
 */
export function checkAgainstArchive(archive: ConversionArchive, bundles: OutlineBundleBody[]): string[] {
  const problems: string[] = []
  const byOutline = new Map(bundles.map(b => [b.outlineId, b]))

  for (const o of archive.outlines) {
    const bundle = byOutline.get(o.outlineSlug)
    if (!bundle) { problems.push(`${o.outlineSlug}: no bundle`); continue }
    const checked = validateBundle(bundle)
    if (typeof checked === 'string') { problems.push(`${o.outlineSlug}: ingest would refuse it: ${checked}`); continue }
    if (bundle.outlineRev !== o.outlineSha) problems.push(`${o.outlineSlug}: outlineRev is not the hash of the text`)

    const snap = archive.package.entities.find(e => refOf(e) === o.entity)
    const first = bundle.entities[0] as OutlineBundleEntity | undefined
    const create = first?.ops[0]
    if (!snap || first?.entityId !== o.entity || create?.op !== 'create-entity') { problems.push(`${o.outlineSlug}: the first entity is not a create of ${o.entity}`); continue }
    if (canonicalize(create.props) !== canonicalize(snap.props))               problems.push(`${o.entity}: props differ from the archive`)
    if (canonicalize(create.edges) !== canonicalize(snap.edges))               problems.push(`${o.entity}: edges differ from the archive`)
    if (canonicalize(create.descriptions) !== canonicalize(snap.descriptions)) problems.push(`${o.entity}: descriptions differ from the archive`)

    const wanted = archive.inbound.filter(i => i.to === o.entity)
    const have = bundle.entities.slice(1).flatMap(e => e.ops).filter((op): op is AddEdgeOp => op.op === 'add-edge')
    if (have.length !== wanted.length) problems.push(`${o.entity}: ${have.length} inbound edge ops, the archive has ${wanted.length}`)
    for (const i of wanted) {
      if (!have.some(h => h.type === i.type && h.from === i.from && h.to === i.to && canonicalize(h.props ?? null) === canonicalize(i.props ?? null))) {
        problems.push(`${o.entity}: the edge ${i.from} -${i.type}-> ${i.to} is missing`)
      }
    }
  }
  for (const b of bundles) if (!archive.outlines.some(o => o.outlineSlug === b.outlineId)) problems.push(`${b.outlineId}: a bundle with no outline in the archive`)

  // Nothing of Sanity in what travels.
  const text = JSON.stringify({ package: archive.package, bundles })
  if (/sanityId|sanityRev|sanityOutlineId|"_rev"/.test(text)) problems.push('a Sanity id or revision is in the package or a bundle')
  for (const e of archive.package.entities) for (const name of Object.keys(e.props)) if (isBridgeProp(name)) problems.push(`${refOf(e)}: bridge prop ${name}`)
  return problems
}

/* ───────────────────────── which edges into a node become ops ───────────────────────── */

/**
 * What to do with an edge that arrives at a converted node from outside it: it becomes an op on the entity it
 * leaves (`from`), or it is left out with a reason (`Unlinked`). Pure, so the rules have a name and a test.
 *  - the other end is no entity, or its slug is not a slug (a bundle cannot name it);
 *  - a person's `MEMBER_OF` without the import's `sourceRef`: the person sync never writes one, so neither the
 *    import nor we made it (decided in #158: dropped without a word to Jan).
 */
export function classifyInbound(e: { fromLabels: string[]; fromProps: Record<string, unknown>; type: string; props: Record<string, unknown> }):
  { reason: null; from: string } | { reason: Unlinked['reason']; from: string | null } {
  const from = edgeTarget(e.fromLabels, e.fromProps)
  if (!from) return { reason: 'not-entity', from: null }
  if (!parseNodeRef(from)) return { reason: 'bad-slug', from }
  if (e.fromLabels.includes('Person') && e.type === 'MEMBER_OF' && e.props.sourceRef === undefined) return { reason: 'not-ours', from }
  return { reason: null, from }
}

/* ───────────────────────── the graph ───────────────────────── */

/** A node's key as text: its slug or id, or null when it has neither as a string. */
function nameOf(props: Record<string, unknown>, kind?: string): string | null {
  const v = (kind ? props[keyProp(kind)] : undefined) ?? props.slug ?? props.id
  return typeof v === 'string' ? v : null
}

interface Row { key: string; labels: string[]; props: Record<string, unknown> }
interface Touch { a: Row; b: Row; type: string; props: Record<string, unknown> }

/** The property the nodes made from outlines carry. A test names another one, so it never touches the real nodes. */
export const OUTLINE_MARKER = 'sanityOutlineId'
const markerOf = (marker: string) => { if (!/^[A-Za-z][A-Za-z0-9]*$/.test(marker)) throw new Error(`not a property name: ${marker}`); return `\`${marker}\`` }

/** Reads the nodes that carry `marker` (`sanityOutlineId`) and everything that touches them. Writes nothing. */
export async function readConversion(session: Session, site: string, marker = OUTLINE_MARKER): Promise<Conversion> {
  const m = markerOf(marker)
  const nodes = (await session.run(
    `MATCH (n) WHERE n.${m} IS NOT NULL RETURN elementId(n) AS key, labels(n) AS labels, properties(n) AS props`,
  )).records.map(r => ({ key: r.get('key') as string, labels: r.get('labels') as string[], props: r.get('props') as Record<string, unknown> }))
  const inside = new Set(nodes.map(n => n.key))

  const touching: Touch[] = (await session.run(
    `MATCH (a)-[r]->(b) WHERE a.${m} IS NOT NULL OR b.${m} IS NOT NULL
     RETURN elementId(a) AS aKey, labels(a) AS aLabels, properties(a) AS aProps,
            elementId(b) AS bKey, labels(b) AS bLabels, properties(b) AS bProps,
            type(r) AS type, properties(r) AS props`,
  )).records.map(r => ({
    a: { key: r.get('aKey'), labels: r.get('aLabels'), props: r.get('aProps') },
    b: { key: r.get('bKey'), labels: r.get('bLabels'), props: r.get('bProps') },
    type: r.get('type') as string, props: r.get('props') as Record<string, unknown>,
  }))

  const outlines = new Map<string, { slug: string; sha: string }>()
  for (const id of new Set(nodes.map(n => n.props[marker] as string))) {
    const r = await session.run(
      `MATCH (o:Outline {sanityId: $id})
       OPTIONAL MATCH (o)-[:HAS_CONTENT]->(d:Description)
       RETURN o.slug AS slug, collect(CASE WHEN d IS NULL THEN null ELSE {order: d.order, content: d.content} END) AS descriptions`,
      { id },
    )
    const row = r.records[0]
    if (!row) throw new Error(`no outline for sanityOutlineId ${id}`)
    outlines.set(id, { slug: row.get('slug') as string, sha: await outlineContentSha(row.get('descriptions') as { order: number | null; content: string | null }[]) })
  }

  const entityNodes = nodes.filter(n => !n.labels.includes('Description'))
  const groups: OutlineGroup[] = []
  const unlinked: Unlinked[] = []

  for (const n of entityNodes) {
    const kind = n.labels.find(l => (KNOWN_KINDS as readonly string[]).includes(l))
    if (!kind) throw new Error(`a node with ${marker} is no entity: ${n.labels.join(':')}`)
    const key = n.props[keyProp(kind)] as string
    const ref = `${kind}:${key}`
    const outline = outlines.get(n.props[marker] as string)!

    const descriptions = touching
      .filter(e => e.type === 'ABOUT' && e.b.key === n.key && e.a.labels.includes('Description') && inside.has(e.a.key))
      .map(e => ({ order: Number(e.a.props.order), content: String(e.a.props.content) }))

    const outbound: EdgeSnapshot[] = []
    for (const e of touching.filter(t => t.a.key === n.key && t.type !== 'HAS_CONTENT')) {
      const to = edgeTarget(e.b.labels, e.b.props)
      if (!to) { unlinked.push({ from: ref, type: e.type, to: `${e.b.labels.join(':')}`, reason: 'not-entity' }); continue }
      const props = stripEdgeProps(e.props)
      outbound.push(props ? { type: e.type, to, props } : { type: e.type, to })
    }

    const inbound: InboundEdge[] = []
    for (const e of touching.filter(t => t.b.key === n.key && !inside.has(t.a.key))) {
      const c = classifyInbound({ fromLabels: e.a.labels, fromProps: e.a.props, type: e.type, props: e.props })
      if (c.reason) { unlinked.push({ from: c.from ?? `${e.a.labels.join(':')}:${nameOf(e.a.props) ?? '?'}`, type: e.type, to: ref, reason: c.reason }); continue }
      const from = c.from
      const props = stripEdgeProps(e.props)
      inbound.push({ from, type: e.type, to: ref, ...(props ? { props } : {}) })
    }
    inbound.sort((a, b) => `${a.from}|${a.type}`.localeCompare(`${b.from}|${b.type}`))

    const path = entityPath(kind, key) ?? `/${kind.toLowerCase()}/${key}`
    groups.push({
      outlineSlug: outline.slug, outlineSha: outline.sha, inbound,
      entity: makeEntitySnapshot({ kind, key, props: n.props, descriptions, edges: outbound, source: { site, path } }),
    })
  }
  groups.sort((a, b) => a.outlineSlug.localeCompare(b.outlineSlug))

  const names = new Map<string, string>()
  for (const t of touching) for (const x of [t.a, t.b]) {
    const kind = x.labels.find(l => l !== 'Description')
    names.set(x.key, `${x.labels.join(':')}:${nameOf(x.props, kind) ?? x.key}`)
  }
  for (const n of nodes) names.set(n.key, `${n.labels.join(':')}:${nameOf(n.props) ?? n.key}`)
  const raw: RawArchive = {
    nodes: nodes.map(n => ({ key: names.get(n.key)!, labels: n.labels, props: n.props })).sort((a, b) => a.key.localeCompare(b.key)),
    edges: touching.map(t => ({ type: t.type, from: names.get(t.a.key)!, to: names.get(t.b.key)!, props: t.props }))
      .sort((a, b) => `${a.from}|${a.type}|${a.to}`.localeCompare(`${b.from}|${b.type}|${b.to}`)),
  }
  return { groups, unlinked, raw }
}

export interface Counts { nodes: number; edges: number; converted: number }

export async function countGraph(session: Session, marker = OUTLINE_MARKER): Promise<Counts> {
  const one = async (cypher: string) => Number((await session.run(cypher)).records[0].get('n'))
  return {
    nodes:     await one('MATCH (n) RETURN count(n) AS n'),
    edges:     await one('MATCH ()-[r]->() RETURN count(r) AS n'),
    converted: await one(`MATCH (n) WHERE n.${markerOf(marker)} IS NOT NULL RETURN count(n) AS n`),
  }
}

/**
 * Removes the converted nodes and every edge that touches them, in one transaction, and nothing else. The
 * transaction is rolled back unless exactly `expected.nodes` nodes and `expected.edges` edges went and the graph
 * has nothing with `sanityOutlineId` left (counts before and after).
 */
export async function removeConverted(session: Session, expected: { nodes: number; edges: number }, marker = OUTLINE_MARKER): Promise<{ before: Counts; after: Counts }> {
  return session.executeWrite(async tx => {
    const count = async (cypher: string) => Number((await tx.run(cypher)).records[0].get('n'))
    const counts = async (): Promise<Counts> => ({
      nodes:     await count('MATCH (n) RETURN count(n) AS n'),
      edges:     await count('MATCH ()-[r]->() RETURN count(r) AS n'),
      converted: await count(`MATCH (n) WHERE n.${markerOf(marker)} IS NOT NULL RETURN count(n) AS n`),
    })
    const before = await counts()
    if (before.converted !== expected.nodes) throw new Error(`${before.converted} nodes carry sanityOutlineId, the archive has ${expected.nodes}: nothing removed`)
    await tx.run(`MATCH (n) WHERE n.${markerOf(marker)} IS NOT NULL DETACH DELETE n`)
    const after = await counts()
    if (after.converted !== 0)                          throw new Error('nodes with sanityOutlineId are left: rolled back')
    if (before.nodes - after.nodes !== expected.nodes) throw new Error(`${before.nodes - after.nodes} nodes went, expected ${expected.nodes}: rolled back`)
    if (before.edges - after.edges !== expected.edges) throw new Error(`${before.edges - after.edges} edges went, expected ${expected.edges}: rolled back`)
    return { before, after }
  })
}
