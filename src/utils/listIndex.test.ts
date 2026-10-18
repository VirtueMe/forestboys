import { describe, expect, it } from 'vitest'
import { listIndexes, type ListBlock } from './listIndex.ts'

const item = (key: string, listItem: string, level: number): ListBlock => ({ _key: key, _type: 'block', listItem, level })
const para = (key: string): ListBlock => ({ _key: key, _type: 'block' })
const numbers = (blocks: ListBlock[]) => Object.fromEntries(listIndexes(blocks))

describe('listIndexes', () => {
  it('numbers the items of a list from 1', () => {
    expect(numbers([item('a', 'number', 1), item('b', 'number', 1), item('c', 'number', 1)])).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('starts again after a paragraph', () => {
    expect(numbers([item('a', 'number', 1), item('b', 'number', 1), para('p'), item('c', 'number', 1)])).toEqual({ a: 1, b: 2, c: 1 })
  })

  it('starts a deeper level at 1, and the shallower level carries on after it', () => {
    expect(numbers([item('a', 'number', 1), item('b', 'number', 2), item('c', 'number', 2), item('d', 'number', 1)]))
      .toEqual({ a: 1, b: 1, c: 2, d: 2 })
  })

  it('starts the deeper level again under the next shallower item', () => {
    expect(numbers([item('a', 'number', 1), item('b', 'number', 2), item('c', 'number', 1), item('d', 'number', 2)]))
      .toEqual({ a: 1, b: 1, c: 2, d: 1 })
  })

  it('starts again when the other kind of list comes in at the same level', () => {
    expect(numbers([item('a', 'number', 1), item('b', 'bullet', 1), item('c', 'number', 1)])).toEqual({ a: 1, b: 1, c: 1 })
  })

  it('gives nothing to a block that is not a list item', () => {
    expect(listIndexes([para('p'), { _key: 'o', _type: 'image' }]).size).toBe(0)
  })

  it('answers the same array from the cache', () => {
    const blocks = [item('a', 'number', 1)]
    expect(listIndexes(blocks)).toBe(listIndexes(blocks))
  })
})

// Containers (#308, #314): a box and a table cell hold lists of blocks of their own.
describe('listIndexes inside containers', () => {
  const box = (key: string, ...content: unknown[]) => ({ _type: 'infoBox', _key: key, content })
  const cell = (key: string, ...content: unknown[]) => ({ _type: 'cell', _key: key, content })
  const grid = (key: string, ...cells: unknown[]) => ({ _type: 'table', _key: key, rows: [{ _type: 'row', _key: `${key}-r`, cells }] })
  const tree = (...nodes: unknown[]) => nodes as ListBlock[]

  it('numbers a list in a cell from 1, whatever list came before it', () => {
    expect(numbers(tree(item('a', 'number', 1), item('b', 'number', 1), grid('t', cell('c', item('x', 'number', 1), item('y', 'number', 1))))))
      .toEqual({ a: 1, b: 2, x: 1, y: 2 })
  })

  it('numbers two cells independently', () => {
    expect(numbers(tree(grid('t', cell('c1', item('a', 'number', 1), item('b', 'number', 1)), cell('c2', item('c', 'number', 1))))))
      .toEqual({ a: 1, b: 2, c: 1 })
  })

  it('does not let a list in a box break the list around it, nor continue it', () => {
    expect(numbers(tree(item('a', 'number', 1), item('b', 'number', 1), box('x', item('c', 'number', 1)), item('d', 'number', 1))))
      .toEqual({ a: 1, b: 2, c: 1, d: 1 })    // the box is not a list item: the list after it starts again, as after a paragraph
  })

  it('applies the level rules inside a cell', () => {
    expect(numbers(tree(grid('t', cell('c', item('a', 'number', 1), item('b', 'number', 2), item('c', 'number', 2), item('d', 'number', 1))))))
      .toEqual({ a: 1, b: 1, c: 2, d: 2 })
  })

  it('numbers a list in a table inside a box', () => {
    expect(numbers(tree(box('x', grid('t', cell('c', item('a', 'bullet', 1), item('b', 'bullet', 1)))))))
      .toEqual({ a: 1, b: 2 })
  })

  it('answers from the cache for the same list, and numbers a new list afresh', () => {
    const blocks = tree(grid('t', cell('c', item('a', 'number', 1))))
    expect(listIndexes(blocks)).toBe(listIndexes(blocks))
    expect(listIndexes(tree(grid('t', cell('c', item('a', 'number', 1)))))).not.toBe(listIndexes(blocks))
  })
})
