import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stampUndo, writeStampUndo } from './stamp-undo.ts'

const rows: { id: string; stamps: Record<string, string> }[] = [
  { id: 'p1', stamps: { home_sha: 'a', name_sha: 'b', name_graphSha: 'c' } },
  { id: 'p2', stamps: { birthYear_sha: 'd' } },
]

describe('stampUndo', () => {
  it('lists exactly the keys each node was given, as nulls', () => {
    const u = stampUndo('person', rows, new Date('2026-10-04T20:00:00Z'))
    expect(u.rows).toEqual([
      { id: 'p1', remove: { home_sha: null, name_sha: null, name_graphSha: null } },
      { id: 'p2', remove: { birthYear_sha: null } },
    ])
    expect(u.createdAt).toBe('2026-10-04T20:00:00.000Z')
  })

  it('carries the Cypher that applies it, for the label the stamps were written on', () => {
    expect(stampUndo('person', rows).undo).toMatch(/MATCH \(p:Person \{sanityId: x\.id\}\) SET p \+= x\.remove/)
    expect(stampUndo('event', rows).undo).toMatch(/e:Operation OR e:Incident SET e \+= x\.remove/)
  })

  it('keeps a node with nothing to remove out of the list only if the caller did', () => {
    expect(stampUndo('person', [{ id: 'p3', stamps: {} }]).rows).toEqual([{ id: 'p3', remove: {} }])
  })
})

describe('writeStampUndo', () => {
  it('writes the file into the folder and returns its path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'undo-'))
    try {
      const file = writeStampUndo('person', rows, join(dir, 'nested', 'sanity-delta'))
      expect(file).toMatch(/person-stamp-undo-.*\.json$/)
      const back = JSON.parse(readFileSync(file, 'utf8')) as { kind: string; rows: unknown[] }
      expect(back.kind).toBe('person')
      expect(back.rows).toHaveLength(2)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
