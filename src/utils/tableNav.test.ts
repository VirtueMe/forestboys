import { describe, expect, it } from 'vitest'
import type { TreeNode } from './blockTree.ts'
import { cellAt, columnsOf, emptyRow, firstBlockOf, firstSpanKey, nextCell, previousCell, rowsWithBlockIn, rowsWithRowAfter } from './tableNav.ts'

const p = (key: string) => ({ _type: 'block', _key: key, style: 'normal', children: [{ _type: 'span', _key: `${key}s`, text: key }] })
const cell = (key: string, ...content: unknown[]) => ({ _type: 'cell', _key: key, content })
const row = (key: string, ...cells: unknown[]) => ({ _type: 'row', _key: key, cells })
const table = (key: string, ...rows: unknown[]) => ({ _type: 'table', _key: key, rows })

/** Two rows of two cells, then a row of one, inside a box, after a paragraph. */
const value = () => [
  p('top'),
  { _type: 'infoBox', _key: 'box', content: [p('in-box'), table('t',
    row('r0', cell('c00', p('a')), cell('c01', p('b'), p('b2'))),
    row('r1', cell('c10', p('c')), cell('c11', p('d'))),
    row('r2', cell('c20', p('e'))),
  )] },
]
const tableOf = () => ((value()[1] as TreeNode).content as TreeNode[])[1]

describe('cellAt', () => {
  it('finds the table, row and column of a block in a cell, and the path to the table', () => {
    const at = cellAt(value(), 'd')
    expect(at).toMatchObject({ row: 1, col: 1 })
    expect(at?.table._key).toBe('t')
    expect(at?.tablePath).toEqual([{ _key: 'box' }, 'content', { _key: 't' }])
  })

  it('finds a second block in the same cell as that cell', () => {
    expect(cellAt(value(), 'b2')).toMatchObject({ row: 0, col: 1 })
  })

  it('is null outside a table: a block at the top, in a box, and a key that is not there', () => {
    expect(cellAt(value(), 'top')).toBeNull()
    expect(cellAt(value(), 'in-box')).toBeNull()
    expect(cellAt(value(), 'nope')).toBeNull()
  })
})

describe('nextCell and previousCell', () => {
  const t = tableOf()

  it('go along the row and then to the first cell of the next row', () => {
    expect(nextCell(t, 0, 0)).toEqual({ row: 0, col: 1 })
    expect(nextCell(t, 0, 1)).toEqual({ row: 1, col: 0 })
    expect(nextCell(t, 1, 1)).toEqual({ row: 2, col: 0 })
  })

  it('stop after the last cell and before the first', () => {
    expect(nextCell(t, 2, 0)).toBeNull()
    expect(previousCell(t, 0, 0)).toBeNull()
  })

  it('go back along the row and then to the last cell of the previous row', () => {
    expect(previousCell(t, 0, 1)).toEqual({ row: 0, col: 0 })
    expect(previousCell(t, 1, 0)).toEqual({ row: 0, col: 1 })
    expect(previousCell(t, 2, 0)).toEqual({ row: 1, col: 1 })
  })
})

describe('firstBlockOf and firstSpanKey', () => {
  it('gives the first text block of a cell and its first span', () => {
    const b = firstBlockOf(tableOf(), 0, 1)
    expect(b?._key).toBe('b')
    expect(firstSpanKey(b as TreeNode)).toBe('bs')
  })

  it('gives nothing for a cell with no blocks, or no such cell', () => {
    const t = table('t', row('r', cell('c'))) as TreeNode
    expect(firstBlockOf(t, 0, 0)).toBeUndefined()
    expect(firstBlockOf(t, 5, 0)).toBeUndefined()
  })
})

describe('growing the table', () => {
  let n = 0
  const key = () => `k${n++}`

  it('counts the columns of the widest row', () => {
    expect(columnsOf(tableOf())).toBe(2)
    expect(columnsOf(table('t') as TreeNode)).toBe(1)
  })

  it('makes a row of empty cells, each with one empty paragraph, as wide as asked and never less than one', () => {
    const r = emptyRow(key, 3)
    expect(r._type).toBe('row')
    const cells = r.cells as TreeNode[]
    expect(cells).toHaveLength(3)
    expect((cells[0].content as TreeNode[])[0]).toMatchObject({ _type: 'block', style: 'normal', children: [{ _type: 'span', text: '' }] })
    expect((emptyRow(key, 0).cells as TreeNode[])).toHaveLength(1)
  })

  it('puts a new row after the given one, as wide as the widest, and leaves the table itself alone', () => {
    const t = tableOf()
    const before = JSON.stringify(t)
    const { rows, added } = rowsWithRowAfter(t, 1, key)
    expect(rows.map(r => r._key)).toEqual(['r0', 'r1', added._key, 'r2'])
    expect(added.cells as TreeNode[]).toHaveLength(2)
    expect(JSON.stringify(t)).toBe(before)
  })

  it('gives every key it makes a new value', () => {
    const { added } = rowsWithRowAfter(tableOf(), 0, key)
    const keys = JSON.stringify(added).match(/"_key":"[^"]+"/g) ?? []
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('rowsWithBlockIn', () => {
  let n = 0
  const key = () => `b${n++}`

  it('gives the same rows when the cell already holds a text block', () => {
    const t = tableOf()
    expect(rowsWithBlockIn(t, 0, 0, key)).toBe(t.rows)
  })

  it('puts an empty paragraph in a cell that holds none, and changes nothing else', () => {
    const t = table('t', row('r0', cell('c0')), row('r1', cell('c1', p('x')))) as TreeNode
    const rows = rowsWithBlockIn(t, 0, 0, key)
    expect(firstBlockOf({ ...t, rows }, 0, 0)).toMatchObject({ _type: 'block', style: 'normal' })
    expect(rows[1]).toBe((t.rows as TreeNode[])[1])
    expect((t.rows as TreeNode[])[0].cells).toEqual([cell('c0')])    // the input is not changed
  })
})
