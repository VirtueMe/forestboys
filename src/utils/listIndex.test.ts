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
