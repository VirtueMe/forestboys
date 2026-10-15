import { describe, expect, it } from 'vitest'
import { bodyOf, bundleIdOfKey, conflicts, fromMetadata, recordKey, recordOf, sharedChanges, summarizeOps, toMetadata } from './entityRecord.ts'

const E = 'Person:ola'
const B1 = 'bundle:ancc:2026-10-01T07:00:00.000Z'
const B2 = 'bundle:sanity-person:2026-10-02T07:00:00.000Z'

describe('summarizeOps', () => {
  it('lists what the ops touch, each once and in order', () => {
    expect(summarizeOps([
      { op: 'set-props', props: { rank: {}, born: {} } },
      { op: 'set-description', order: 2 },
      { op: 'modify-block', blockPath: 'section.a.block.k1' },
      { op: 'add-edge', type: 'MEMBER_OF', to: 'Unit:x' },
      { op: 'remove-edge', type: 'MEMBER_OF', to: 'Unit:x' },
    ])).toEqual({ props: ['born', 'rank'], blocks: ['description:2', 'section.a.block.k1'], edges: ['MEMBER_OF:Unit:x'],
      ops: ['add-edge', 'modify-block', 'remove-edge', 'set-description', 'set-props'] })
  })
  it('reads a create-entity as props, edges and descriptions', () => {
    expect(summarizeOps([{ op: 'create-entity', props: { name: 1 }, edges: [{ type: 'AT', to: 'Location:y' }], descriptions: [{ order: 0 }] }]))
      .toMatchObject({ props: ['name'], edges: ['AT:Location:y'], blocks: ['description:0'], ops: ['create-entity'] })
  })
})

describe('the key and the body', () => {
  it('has the bundle id in the key and a pointer, not the ops, in the body', () => {
    expect(recordKey(E, B1)).toBe(`proposals/by-entity/Person:ola/${B1}.json`)
    expect(bundleIdOfKey(E, recordKey(E, B1))).toBe(B1)
    expect(bodyOf({ bundleId: B1, entityId: E })).toEqual({ bundleId: B1, entityId: E, payload: `proposals/bundles/${B1}/entity/${E}.json` })
  })
  it('skips the old shared index and keys of another entity', () => {
    expect(bundleIdOfKey(E, 'proposals/by-entity/Person:ola/index.json')).toBeNull()
    expect(bundleIdOfKey(E, `proposals/by-entity/Person:olav/${B1}.json`)).toBeNull()
  })
})

describe('the metadata', () => {
  it('is only strings and comes back as the record', () => {
    const r = recordOf(B1, E, 'pending', [{ op: 'set-props', props: { rank: {} } }, { op: 'add-edge', type: 'AT', to: 'Location:y' }])
    const meta = toMetadata(r)
    expect(Object.values(meta).every(v => typeof v === 'string')).toBe(true)
    expect(fromMetadata(E, recordKey(E, B1), meta)).toEqual(r)
  })
  it('stays under 2 KB with huge lists, and says that it cut', () => {
    const edges = Array.from({ length: 400 }, (_, i) => ({ type: 'MEMBER_OF', to: `Person:someone-${i}` }))
    const r = recordOf(B1, E, 'pending', edges.map(e => ({ op: 'add-edge', ...e })))
    const meta = toMetadata(r)
    expect(new TextEncoder().encode(Object.entries(meta).flat().join('')).length).toBeLessThan(2048)
    expect(fromMetadata(E, recordKey(E, B1), meta)?.truncated).toBe(true)
  })
  it('is not read from an object that is not a record', () => {
    expect(fromMetadata(E, recordKey(E, B1), undefined)).toBeNull()
    expect(fromMetadata(E, recordKey(E, B1), { status: 'weird' })).toBeNull()
    expect(fromMetadata(E, 'proposals/by-entity/Person:ola/index.json', { status: 'pending' })).toBeNull()
  })
})

describe('conflicts', () => {
  const a = recordOf(B1, E, 'pending', [{ op: 'set-props', props: { rank: {} } }])
  it('flags two pending bundles that change the same property, and not different ones', () => {
    expect(conflicts(a, recordOf(B2, E, 'pending', [{ op: 'set-props', props: { rank: {}, born: {} } }]))).toBe(true)
    expect(conflicts(a, recordOf(B2, E, 'pending', [{ op: 'set-props', props: { born: {} } }]))).toBe(false)
  })
  it('ignores a bundle that is decided, and the bundle itself', () => {
    expect(conflicts(a, recordOf(B2, E, 'accepted', [{ op: 'set-props', props: { rank: {} } }]))).toBe(false)
    expect(conflicts(a, a)).toBe(false)
  })
  it('treats a delete as touching everything, and a cut list as possibly touching', () => {
    const del = recordOf(B2, E, 'pending', [{ op: 'delete-entity' }])
    expect(sharedChanges(a, del)).toEqual(['entity'])
    expect(conflicts(a, del)).toBe(true)
    expect(conflicts(a, { ...recordOf(B2, E, 'pending', []), truncated: true })).toBe(true)
  })
})

describe('relatedFor', () => {
  const rank = (id: string, status: 'pending' | 'accepted' | 'archived', ...props: string[]) => recordOf(id, E, status, [{ op: 'set-props', props: Object.fromEntries(props.map(p => [p, {}])) }])
  const B3 = 'bundle:ancc:2026-10-03T07:00:00.000Z'

  it('leaves out the bundle itself, lists the others newest first with their date, and shares what two waiting ones both change', async () => {
    const { relatedFor } = await import('./entityRecord.ts')
    const rel = relatedFor(B1, [rank(B1, 'pending', 'rank'), rank(B2, 'pending', 'rank', 'born'), rank(B3, 'accepted', 'rank')])
    expect(rel.map(r => r.bundleId)).toEqual([B3, B2])
    expect(rel[1]).toMatchObject({ createdAt: '2026-10-02T07:00:00.000Z', status: 'pending', shared: ['rank'] })
    expect(rel[0].shared).toEqual([])    // decided: not a conflict
  })

  it('shares nothing when this bundle has no record, or the others change other things', async () => {
    const { relatedFor } = await import('./entityRecord.ts')
    expect(relatedFor(B1, [rank(B2, 'pending', 'rank')])[0].shared).toEqual([])
    expect(relatedFor(B1, [rank(B1, 'pending', 'rank'), rank(B2, 'pending', 'born')])[0].shared).toEqual([])
  })

  it('marks a cut list as a possible overlap with a question mark', async () => {
    const { relatedFor } = await import('./entityRecord.ts')
    const cut = { ...rank(B2, 'pending', 'born'), truncated: true }
    expect(relatedFor(B1, [rank(B1, 'pending', 'rank'), cut])[0].shared).toEqual(['?'])
  })
})
