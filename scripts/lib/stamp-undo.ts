/**
 * The undo file of a stamping run (#80). `--stamp --write` adds properties to nodes that may already carry
 * stamps from earlier applies, so "remove every _sha" would be wrong: this lists, per node, exactly the keys
 * the run added, as a map of nulls — setting a property to null removes it — and the Cypher that applies it.
 * Written before the first stamp, to data/sanity-delta/.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type StampKind = 'person' | 'event'

export interface StampUndo {
  kind:      StampKind
  createdAt: string
  /** Run with the `rows` below as $rows. */
  undo:      string
  rows:      { id: string; remove: Record<string, null> }[]
}

const UNDO_CYPHER: Record<StampKind, string> = {
  person: 'UNWIND $rows AS x MATCH (p:Person {sanityId: x.id}) SET p += x.remove',
  event:  'UNWIND $rows AS x MATCH (e {sanityId: x.id}) WHERE e:Operation OR e:Incident SET e += x.remove',
}

/** The undo for stamps about to be written: what to remove from each node to take them back. */
export function stampUndo(kind: StampKind, rows: { id: string; stamps: Record<string, string> }[], now = new Date()): StampUndo {
  return {
    kind,
    createdAt: now.toISOString(),
    undo: UNDO_CYPHER[kind],
    rows: rows.map(r => ({ id: r.id, remove: Object.fromEntries(Object.keys(r.stamps).map(k => [k, null])) })),
  }
}

/** Writes the undo file and returns its path. */
export function writeStampUndo(kind: StampKind, rows: { id: string; stamps: Record<string, string> }[], dir = resolve(process.cwd(), 'data', 'sanity-delta')): string {
  const undo = stampUndo(kind, rows)
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, `${kind}-stamp-undo-${undo.createdAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(undo) + '\n')
  return file
}
