import { describe, expect, it } from 'vitest'
import { containedBy, isContainer, mapBlocks, siblingLists, walkBlocks, type Place, type TreeNode } from './blockTree.ts'
import type { SanityBlock } from './portableText.ts'

const p = (key: string, text = key, over: Partial<SanityBlock> = {}): SanityBlock =>
  ({ _key: key, _type: 'block', style: 'normal', children: [{ _key: `${key}s`, _type: 'span', text }], ...over })
const cell = (key: string, ...content: unknown[]) => ({ _type: 'cell', _key: key, content })
const row = (key: string, ...cells: unknown[]) => ({ _type: 'row', _key: key, cells })
const table = (key: string, ...rows: unknown[]) => ({ _type: 'table', _key: key, rows })
const box = (key: string, ...content: unknown[]) => ({ _type: 'infoBox', _key: key, content })

/** A box that holds a paragraph and a table of two cells, between two top-level paragraphs. */
const tree = () => [
  p('a'),
  box('box', p('b'), table('t', row('r', cell('c1', p('c'), p('d')), cell('c2', p('e'))))),
  { _type: 'image', _key: 'img' },
  p('f'),
]

describe('isContainer and containedBy', () => {
  it('knows a box, a table, a row and a cell, and a type it has never seen', () => {
    expect(isContainer(box('b', p('x')))).toBe(true)
    expect(isContainer(table('t', row('r', cell('c', p('x')))))).toBe(true)
    expect(isContainer({ _type: 'columns', left: [p('x')], right: [p('y')] })).toBe(true)
  })

  it('does not take a text block, an image or an empty box for one', () => {
    expect(isContainer(p('a'))).toBe(false)
    expect(isContainer({ _type: 'image', _key: 'i' })).toBe(false)
    expect(isContainer(box('b'))).toBe(false)
    expect(isContainer('text')).toBe(false)
    expect(isContainer(null)).toBe(false)
  })

  it('lists what a container holds, in field order, and skips what is not typed', () => {
    const c = { _type: 'columns', left: [p('x'), 'stray'], right: [p('y')] }
    expect(containedBy(c).map(n => n._key)).toEqual(['x', 'y'])
  })
})

describe('walkBlocks', () => {
  const seen = (nodes: unknown) => {
    const out: { key: string; ancestors: string[]; previous?: string }[] = []
    walkBlocks(nodes, (b: SanityBlock, place: Place) => out.push({ key: b._key, ancestors: [...place.ancestors], previous: place.previous?._key }))
    return out
  }

  it('visits every text block in reading order, in and out of containers', () => {
    expect(seen(tree()).map(s => s.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('says which containers a block is in, outermost first', () => {
    const at = Object.fromEntries(seen(tree()).map(s => [s.key, s.ancestors]))
    expect(at.a).toEqual([])
    expect(at.b).toEqual(['infoBox'])
    expect(at.c).toEqual(['infoBox', 'table', 'row', 'cell'])
    expect(at.f).toEqual([])
  })

  it('gives the sibling before in the block\'s own list, and nothing across a container boundary', () => {
    const before = Object.fromEntries(seen(tree()).map(s => [s.key, s.previous]))
    expect(before.a).toBeUndefined()
    expect(before.b).toBeUndefined()      // first in the box
    expect(before.d).toBe('c')            // within the cell
    expect(before.e).toBeUndefined()      // first in the second cell, not after the first cell's blocks
    expect(before.f).toBe('img')          // after an image at the top
  })

  it('ignores what is not a list', () => {
    expect(seen(null)).toEqual([])
    expect(seen('x')).toEqual([])
  })
})

describe('siblingLists', () => {
  it('gives the top list and the list inside each container, each with the containers around it', () => {
    const lists = siblingLists(tree()).map(l => ({ keys: l.list.map((n: TreeNode) => n._key), ancestors: [...l.ancestors] }))
    expect(lists).toEqual([
      { keys: ['a', 'box', 'img', 'f'], ancestors: [] },
      { keys: ['b', 't'], ancestors: ['infoBox'] },
      { keys: ['r'], ancestors: ['infoBox', 'table'] },
      { keys: ['c1', 'c2'], ancestors: ['infoBox', 'table', 'row'] },
      { keys: ['c', 'd'], ancestors: ['infoBox', 'table', 'row', 'cell'] },
      { keys: ['e'], ancestors: ['infoBox', 'table', 'row', 'cell'] },
    ])
  })
})

describe('mapBlocks', () => {
  const upper = (b: SanityBlock): SanityBlock => ({ ...b, children: (b.children ?? []).map(c => ({ ...c, text: c.text.toUpperCase() })) })
  const textsOf = (nodes: unknown) => { const t: string[] = []; walkBlocks(nodes, b => t.push((b.children ?? []).map(c => c.text).join(''))); return t }

  it('changes every text block, inside containers too, and leaves the rest as it was', () => {
    const before = tree()
    const after = mapBlocks(before, upper)
    expect(textsOf(after)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(textsOf(before)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])   // the input is not changed
    expect((after as TreeNode[])[2]).toBe(before[2])                  // the image is the same object
  })

  it('gives back the same list, and the same containers, when nothing changes', () => {
    const before = tree()
    expect(mapBlocks(before, b => b)).toBe(before)
  })

  it('copies only the containers on the way to a change', () => {
    const before = tree()
    const after = mapBlocks(before, b => (b._key === 'e' ? upper(b) : b)) as TreeNode[]
    expect(after).not.toBe(before)
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(after[3]).toBe(before[3])
  })

  it('hands each block its place', () => {
    const places: Record<string, string> = {}
    mapBlocks(tree(), (b, place) => { places[b._key] = place.ancestors.join('>'); return b })
    expect(places.a).toBe('')
    expect(places.d).toBe('infoBox>table>row>cell')
  })

  it('returns what is not a list as it is, and keeps entries that are not typed', () => {
    expect(mapBlocks(null, upper)).toBeNull()
    const c = { _type: 'columns', _key: 'k', left: [p('x'), 'stray'] }
    const out = mapBlocks([c], upper) as { left: unknown[] }[]
    expect(out[0].left[1]).toBe('stray')
    expect(textsOf(out)).toEqual(['X'])
  })
})
