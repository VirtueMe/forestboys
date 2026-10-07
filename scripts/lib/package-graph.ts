/**
 * Reading entities out of the graph for packages (docs/BUNDLE-FORMAT.md, #159): the rows an entity is
 * made of, and the node a snapshot is compared with. The decisions are pure and tested; only
 * `readEntity` and `findNode` talk to the graph.
 */

import type { Session } from 'neo4j-driver'
import { keyProp, parseNodeRef } from '../../functions/_lib/entity-ref.ts'
import type { DescriptionSnapshot, EdgeSnapshot } from '../../functions/_lib/bundle-package.ts'
import type { LiveEntity } from '../../functions/_lib/snapshot-diff.ts'

/** The kinds a package may hold: the labels of nodes that are entities in their own right. */
export const KNOWN_KINDS = [
  'Person', 'Unit', 'Station', 'Transport', 'Operation', 'Incident', 'Location', 'Outline', 'Organization',
  'Article', 'EquipmentType', 'Source',
] as const

/** `Kind:key` as given on a command line. Null when it is not a known kind or has no key. */
export function parseRef(ref: string): { kind: string; key: string } | null {
  const r = parseNodeRef(ref.trim())
  return r && (KNOWN_KINDS as readonly string[]).includes(r.kind) ? r : null
}

/** The `<Kind>:<key>` an edge points at, from the target node's labels and properties. Null for a node that is no entity. */
export function edgeTarget(labels: string[], props: Record<string, unknown>): string | null {
  const kind = labels.find(l => (KNOWN_KINDS as readonly string[]).includes(l))
  if (!kind) return null
  const key = props[keyProp(kind)]
  return typeof key === 'string' && key ? `${kind}:${key}` : null
}

export interface EntityRows {
  props:        Record<string, unknown>
  descriptions: { order: unknown; content: unknown }[]
  edges:        { type: string; labels: string[]; target: Record<string, unknown>; props: Record<string, unknown> }[]
}

export interface EntityParts { props: Record<string, unknown>; descriptions: DescriptionSnapshot[]; edges: EdgeSnapshot[]; skippedEdges: number }

/** The parts a snapshot and a comparison are made of, and how many edges were left out because they do not point at an entity. */
export function entityParts(rows: EntityRows): EntityParts {
  const descriptions = rows.descriptions
    .filter((d): d is DescriptionSnapshot => Number.isInteger(d.order) && typeof d.content === 'string')
    .sort((a, b) => a.order - b.order)
  const edges: EdgeSnapshot[] = []
  let skippedEdges = 0
  for (const e of rows.edges) {
    const to = edgeTarget(e.labels, e.target)
    if (!to) { skippedEdges++; continue }
    edges.push(Object.keys(e.props).length ? { type: e.type, to, props: e.props } : { type: e.type, to })
  }
  return { props: rows.props, descriptions, edges, skippedEdges }
}

/** One entity as the graph holds it, or null. The HAS_CONTENT edges are the descriptions, not edges. */
export async function readEntity(session: Session, kind: string, key: string): Promise<EntityParts | null> {
  const r = await session.run(
    `MATCH (n:\`${kind}\` {${keyProp(kind)}: $key})
     OPTIONAL MATCH (n)-[:HAS_CONTENT]->(d:Description)
     WITH n, [x IN collect(d) WHERE x IS NOT NULL | {order: x.order, content: x.content}] AS descriptions
     OPTIONAL MATCH (n)-[r]->(m) WHERE type(r) <> 'HAS_CONTENT'
     RETURN properties(n) AS props, descriptions,
            [x IN collect(CASE WHEN r IS NULL THEN null ELSE {type: type(r), labels: labels(m), target: properties(m), props: properties(r)} END) WHERE x IS NOT NULL] AS edges`,
    { key },
  )
  if (!r.records.length) return null
  const row = r.records[0]
  return entityParts({ props: row.get('props') as Record<string, unknown>, descriptions: row.get('descriptions') as EntityRows['descriptions'], edges: row.get('edges') as EntityRows['edges'] })
}

/** The node a snapshot is compared with: the one an earlier import made from the same source ref, else the same kind and key. */
export async function findNode(
  session: Session, kind: string, key: string, sourceRef: string,
): Promise<{ key: string; live: LiveEntity; linked: boolean } | null> {
  const byRef = await session.run(`MATCH (n:\`${kind}\`) WHERE n.importedFrom = $ref RETURN n.${keyProp(kind)} AS key LIMIT 1`, { ref: sourceRef })
  const linkedKey = byRef.records[0]?.get('key') as string | undefined
  const useKey = linkedKey ?? key
  const live = await readEntity(session, kind, useKey)
  return live ? { key: useKey, live: { props: live.props, descriptions: live.descriptions, edges: live.edges }, linked: linkedKey !== undefined } : null
}
