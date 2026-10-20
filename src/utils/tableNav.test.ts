import { describe, expect, it } from 'vitest'
import type { TreeNode } from './blockTree.ts'
import { addColumn, addRow, cellAt, columnsOf, deleteColumn, deleteRow, emptyRow, firstBlockOf, firstSpanKey, frameOf, isLastSibling, nextCell, optionEdit, previousCell, widthOf, rowsWithBlockIn, rowsWithRowAfter } from './tableNav.ts'

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

describe('structure edits', () => {
  let n = 0
  const key = () => `n${n++}`
  const keys = (rows: TreeNode[]) => rows.map(r => r._key)
  const widths = (rows: TreeNode[]) => rows.map(r => (r.cells as TreeNode[]).length)
  const cellKeys = (rows: TreeNode[], i: number) => (rows[i].cells as TreeNode[]).map(c => c._key)

  describe('addRow', () => {
    it('puts a new row above or below, as wide as the widest, and keeps the other rows and the caret where they are', () => {
      const t = tableOf()
      const below = addRow(t, 1, 'below', key)
      expect(keys(below.rows).filter(k => !String(k).startsWith('n'))).toEqual(['r0', 'r1', 'r2'])
      expect(below.rows.map(r => r._key)[2]).toMatch(/^n/)
      expect(widths(below.rows)).toEqual([2, 2, 2, 1])
      expect(below.select).toBeNull()
      const above = addRow(t, 0, 'above', key)
      expect(above.rows[0]._key).toMatch(/^n/)
      expect(above.rows[1]._key).toBe('r0')
    })

    it('does not change the table it was given', () => {
      const t = tableOf(); const before = JSON.stringify(t)
      addRow(t, 0, 'below', key)
      expect(JSON.stringify(t)).toBe(before)
    })
  })

  describe('deleteRow', () => {
    it('takes the row out and puts the caret in the same column of the row that took its place', () => {
      const out = deleteRow(tableOf(), 1, 1)!
      expect(keys(out.rows)).toEqual(['r0', 'r2'])
      expect(out.select).toEqual({ row: 1, col: 0 })    // r2 has one cell: the column is cut to fit
    })

    it('puts the caret in the row above when the last row went', () => {
      expect(deleteRow(tableOf(), 2, 0)!.select).toEqual({ row: 1, col: 0 })
    })

    it('refuses the only row, and a row that is not there', () => {
      expect(deleteRow(table('t', row('r', cell('c', p('x')))) as TreeNode, 0, 0)).toBeNull()
      expect(deleteRow(tableOf(), 9, 0)).toBeNull()
    })
  })

  describe('addColumn', () => {
    it('puts a new cell before or after the column in every row, and a short row gets it at its end', () => {
      const t = tableOf()
      const after = addColumn(t, 0, 'after', key)
      expect(widths(after.rows)).toEqual([3, 3, 2])
      expect(cellKeys(after.rows, 0)[0]).toBe('c00')
      expect(cellKeys(after.rows, 0)[1]).toMatch(/^n/)
      expect(cellKeys(after.rows, 0)[2]).toBe('c01')
      const before = addColumn(t, 0, 'before', key)
      expect(cellKeys(before.rows, 1)[0]).toMatch(/^n/)
      expect(cellKeys(before.rows, 1)[1]).toBe('c10')
      expect(before.select).toBeNull()
    })

    it('does not change the table it was given', () => {
      const t = tableOf(); const before = JSON.stringify(t)
      addColumn(t, 1, 'after', key)
      expect(JSON.stringify(t)).toBe(before)
    })

    it('makes every new cell hold one empty paragraph', () => {
      const cellsOfNew = (addColumn(tableOf(), 1, 'after', key).rows[0].cells as TreeNode[])[2]
      expect(cellsOfNew.content).toHaveLength(1)
      expect((cellsOfNew.content as TreeNode[])[0]).toMatchObject({ _type: 'block', style: 'normal' })
    })
  })

  describe('deleteColumn', () => {
    it('takes the cell out of every row and puts the caret in the cell that took its place, in the same row', () => {
      const out = deleteColumn(tableOf(), 0, 1)!
      expect(widths(out.rows)).toEqual([1, 1, 1])      // the row of one cell keeps it: no row is left with none
      expect(cellKeys(out.rows, 0)).toEqual(['c01'])
      expect(out.select).toEqual({ row: 1, col: 0 })
    })

    it('puts the caret in the cell before when the last column went', () => {
      expect(deleteColumn(tableOf(), 1, 0)!.select).toEqual({ row: 0, col: 0 })
    })

    it('refuses the only column', () => {
      expect(deleteColumn(table('t', row('r', cell('c', p('x')))) as TreeNode, 0, 0)).toBeNull()
    })
  })
})

describe('optionEdit and frameOf', () => {
  it('writes an option that is not the default', () => {
    expect(optionEdit({ frame: 'around' })).toEqual({ set: { frame: 'around' }, unset: [] })
    expect(optionEdit({ frame: 'topBottom' })).toEqual({ set: { frame: 'topBottom' }, unset: [] })
    expect(optionEdit({ rowLines: true })).toEqual({ set: { rowLines: true }, unset: [] })
    expect(optionEdit({ columnLines: true })).toEqual({ set: { columnLines: true }, unset: [] })
    expect(optionEdit({ width: 'full' })).toEqual({ set: { width: 'full' }, unset: [] })
  })

  it('takes the field away for the default, so a plain table has no option fields at all', () => {
    expect(optionEdit({ frame: 'none' })).toEqual({ set: {}, unset: ['frame'] })
    expect(optionEdit({ rowLines: false })).toEqual({ set: {}, unset: ['rowLines'] })
    expect(optionEdit({ columnLines: false })).toEqual({ set: {}, unset: ['columnLines'] })
    expect(optionEdit({ width: 'compact' })).toEqual({ set: {}, unset: ['width'] })
  })

  it('reads the frame, and a missing or unknown one as none', () => {
    expect(frameOf({ _type: 'table', frame: 'around' })).toBe('around')
    expect(frameOf({ _type: 'table', frame: 'topBottom' })).toBe('topBottom')
    expect(frameOf({ _type: 'table' })).toBe('none')
    expect(frameOf({ _type: 'table', frame: 'dotted' })).toBe('none')
    expect(frameOf({ _type: 'table', frame: 'none' })).toBe('none')
  })

  it('reads the width, and a missing or unknown one as compact', () => {
    expect(widthOf({ _type: 'table', width: 'full' })).toBe('full')
    expect(widthOf({ _type: 'table' })).toBe('compact')
    expect(widthOf({ _type: 'table', width: 'compact' })).toBe('compact')
    expect(widthOf({ _type: 'table', width: 'wide' })).toBe('compact')
  })
})

describe('isLastSibling', () => {
  it('is true for the last of the top list and the last of a box, false for the rest and for a key that is not there', () => {
    const v = [p('a'), { _type: 'infoBox', _key: 'box', content: [p('b'), table('t', row('r', cell('c', p('x'))))] }, p('z')]
    expect(isLastSibling(v, 'z')).toBe(true)
    expect(isLastSibling(v, 'box')).toBe(false)
    expect(isLastSibling(v, 't')).toBe(true)
    expect(isLastSibling(v, 'b')).toBe(false)
    expect(isLastSibling(v, 'nope')).toBe(false)
  })
})
