/**
 * Save one node's list of relations as a difference, in one transaction.
 *
 * The relation editors send the whole list. Deleting every edge and creating
 * the list again wiped what the edges carry — the import's provenance
 * (`state`, `sourceRef`), which the Sanity sync reads — on every save, and
 * a crash between the two calls left the node with no edges at all. Here:
 *
 *   kept     edges to targets still in the list are left alone, apart from
 *            the editable props the list sends (role, dates …)
 *   removed  edges of this type, to this kind of target, no longer in the list
 *   added    new edges get `state: 'verified', sourceRef: 'admin-edit'`
 *
 * One edge per (anchor, target) pair — the lists don't hold duplicates.
 */

import { runCypherTx, type Neo4jEnv } from './neo4j.ts'

export interface EdgeSetSpec {
  /** The node whose list is saved. */
  anchor:      { label: string; slug: string }
  rel:         string
  /** 'out' = (anchor)-[rel]->(target), 'in' = (target)-[rel]->(anchor). */
  direction:   'out' | 'in'
  targetLabel: string
  /** Narrows which targets belong to this list — Cypher on `t`, e.g. `coalesce(t.type, '') <> 'course'`. */
  targetWhere?: string
  items:       { slug: string; props?: Record<string, unknown> }[]
}

export const ADMIN_EDGE = { state: 'verified', sourceRef: 'admin-edit' } as const

export async function saveEdgeSet(env: Neo4jEnv, spec: EdgeSetSpec): Promise<void> {
  const a = `(a:\`${spec.anchor.label}\` {slug: $anchor})`
  const t = `(t:\`${spec.targetLabel}\`)`
  const edge = spec.direction === 'out' ? `${a}-[r:\`${spec.rel}\`]->${t}` : `${a}<-[r:\`${spec.rel}\`]-${t}`
  const where = spec.targetWhere ? `(${spec.targetWhere}) AND ` : ''
  const merge = spec.direction === 'out' ? `(a)-[r:\`${spec.rel}\`]->(t)` : `(a)<-[r:\`${spec.rel}\`]-(t)`
  const items = spec.items.map(i => ({ slug: i.slug, props: i.props ?? {} }))

  await runCypherTx(env, [
    {
      statement:  `MATCH ${edge} WHERE ${where}NOT t.slug IN $slugs DELETE r`,
      parameters: { anchor: spec.anchor.slug, slugs: items.map(i => i.slug) },
    },
    {
      statement: `
        MATCH ${a}
        UNWIND $items AS x
        MATCH (t:\`${spec.targetLabel}\` {slug: x.slug})${spec.targetWhere ? ` WHERE ${spec.targetWhere}` : ''}
        MERGE ${merge}
          ON CREATE SET r = $created, r += x.props
          ON MATCH  SET r += x.props`,
      parameters: { anchor: spec.anchor.slug, items, created: ADMIN_EDGE },
    },
  ])
}
