/**
 * Notes on one edge of a relation that allows several edges to the same
 * target (a stay, a rank history entry). A relationship can't point at a
 * relationship, so the note carries the edge's id:
 *
 *   (Person)-[:<noteEdge>]->(Description {<keyProp>: <edge id>})-[:<aboutEdge>]->(target)
 *
 * The target follows the edge's current end. Replace-all per edge; an
 * empty section list clears the note (also fine for an edge that is gone).
 */

import { runCypher, runCypherTx, type Neo4jEnv } from './neo4j.ts'

export interface EdgeNoteKind {
  /** Relationship type of the edge the note is about, e.g. 'STATIONED_AT'. */
  edge:      string
  noteEdge:  string
  aboutEdge: string
  /** Property on the Description holding the edge id, e.g. 'stayId'. */
  keyProp:   string
  /** Description id prefix, e.g. 'desc:stay'. */
  idPrefix:  string
  /** Norwegian noun for errors, e.g. 'Oppholdet'. */
  noun:      string
}

interface CitationInput { inline: boolean; sourceId: string }
interface SectionInput  { order: number; content: string; citations?: CitationInput[]; sourcedFromId?: string | null }

/** Validates a request body's `sections`; returns them or an error string. */
export function parseSections(body: unknown): SectionInput[] | string {
  const sections = (body as { sections?: unknown } | null)?.sections
  if (!Array.isArray(sections)) return 'sections must be an array'
  for (const s of sections as SectionInput[]) {
    if (!Number.isInteger(s.order) || s.order < 1) return `Bad section order: ${s.order}`
    if (typeof s.content !== 'string') return 'Bad section content'
    try { JSON.parse(s.content) } catch { return 'section content must be JSON' }
    if (s.citations !== undefined) {
      if (!Array.isArray(s.citations)) return 'Bad citations type'
      for (const c of s.citations) {
        if (typeof c.sourceId !== 'string' || !c.sourceId) return 'Bad citation sourceId'
        if (typeof c.inline !== 'boolean') return 'Bad citation inline'
      }
    }
    if (s.sourcedFromId !== undefined && s.sourcedFromId !== null && typeof s.sourcedFromId !== 'string') {
      return 'Bad sourcedFromId'
    }
  }
  return sections as SectionInput[]
}

export async function writeEdgeNote(
  env: Neo4jEnv, kind: EdgeNoteKind, edgeId: string, sections: SectionInput[],
): Promise<{ ok: true; count: number } | { error: string; status: number }> {
  const payload = sections.map(s => ({
    id:            `${kind.idPrefix}:${edgeId}:${s.order}`,
    order:         s.order,
    content:       s.content,
    citations:     s.citations ?? [],
    sourcedFromId: typeof s.sourcedFromId === 'string' ? s.sourcedFromId : null,
  }))

  const wipe = {
    statement:  `MATCH (:Person)-[:${kind.noteEdge}]->(d:Description {${kind.keyProp}: $edgeId}) DETACH DELETE d`,
    parameters: { edgeId },
  }

  if (!payload.length) {
    await runCypher(env, wipe.statement, wipe.parameters)
    return { ok: true, count: 0 }
  }

  const found = await runCypher(env,
    `MATCH (:Person)-[r:${kind.edge} {id: $edgeId}]->() RETURN r.id AS id`, { edgeId })
  if (!found.length) return { error: `${kind.noun} finnes ikke: ${edgeId}`, status: 404 }

  await runCypherTx(env, [wipe, {
    statement: `
      MATCH (p:Person)-[:${kind.edge} {id: $edgeId}]->(target)
      UNWIND $sections AS s
      CREATE (p)-[:${kind.noteEdge}]->(d:Description {
        id: s.id, ${kind.keyProp}: $edgeId, order: s.order, content: s.content
      })
      CREATE (d)-[:${kind.aboutEdge}]->(target)
      WITH d, s
      OPTIONAL MATCH (fromSrc:Source {id: s.sourcedFromId})
      FOREACH (_ IN CASE WHEN s.sourcedFromId IS NOT NULL AND fromSrc IS NOT NULL THEN [1] ELSE [] END |
        CREATE (d)-[:SOURCED_FROM]->(fromSrc)
      )
      WITH d, s
      UNWIND (CASE WHEN size(s.citations) > 0 THEN s.citations ELSE [null] END) AS cite
      OPTIONAL MATCH (citeSrc:Source {id: cite.sourceId})
      FOREACH (_ IN CASE WHEN cite IS NOT NULL AND citeSrc IS NOT NULL THEN [1] ELSE [] END |
        CREATE (d)-[:CITES {inline: cite.inline}]->(citeSrc)
      )
    `,
    parameters: { edgeId, sections: payload },
  }])
  return { ok: true, count: payload.length }
}

/** Cypher statements that re-point notes whose edge now has a different person or target. */
export function repointNoteStatements(kind: EdgeNoteKind): string[] {
  return [
    `UNWIND $ids AS id
     MATCH (p:Person)-[:${kind.edge} {id: id}]->()
     MATCH (op:Person)-[h:${kind.noteEdge}]->(d:Description {${kind.keyProp}: id}) WHERE op <> p
     DELETE h CREATE (p)-[:${kind.noteEdge}]->(d)`,
    `UNWIND $ids AS id
     MATCH (:Person)-[:${kind.edge} {id: id}]->(t)
     MATCH (d:Description {${kind.keyProp}: id})-[a:${kind.aboutEdge}]->(ot) WHERE ot <> t
     DELETE a CREATE (d)-[:${kind.aboutEdge}]->(t)`,
  ]
}

export const STAY_NOTE: EdgeNoteKind = {
  edge: 'STATIONED_AT', noteEdge: 'HAS_STATIONED_NOTE', aboutEdge: 'ABOUT_PLACE',
  keyProp: 'stayId', idPrefix: 'desc:stay', noun: 'Oppholdet',
}

export const RANK_NOTE: EdgeNoteKind = {
  edge: 'HELD_RANK', noteEdge: 'HAS_RANK_NOTE', aboutEdge: 'ABOUT_RANK',
  keyProp: 'rankEntryId', idPrefix: 'desc:rank', noun: 'Graden',
}
