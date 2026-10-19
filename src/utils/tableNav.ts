/**
 * Moving around a table of cells while editing, and growing it (#312). Pure: the editor's behaviours read the value,
 * ask here where to go or what the table should become, and send the editor that. A table is
 * `table › rows › row › cells › cell › content › blocks`; its cells are walked left to right, row by row.
 */

import { findNode, isTextBlock, walkBlocks, type PathSegment, type TreeNode } from './blockTree.ts'

export interface CellAt {
  /** The editor path to the table, to set its fields. */
  tablePath: PathSegment[]
  table:     TreeNode
  row:       number
  col:       number
}

const list = (v: unknown): TreeNode[] => Array.isArray(v) ? v.filter((x): x is TreeNode => !!x && typeof x === 'object') : []
const cellsOf = (table: TreeNode, row: number): TreeNode[] => list(list(table.rows)[row]?.cells)

/** Where the text block with `blockKey` is in a table: the table and its row and column. Null outside a table cell. */
export function cellAt(nodes: unknown, blockKey: string): CellAt | null {
  const found = findNode(nodes, blockKey)
  if (!found) return null
  const containers = found.containers
  let t = -1
  containers.forEach((c, i) => { if (c._type === 'table') t = i })
  if (t === -1 || containers[t + 1]?._type !== 'row' || containers[t + 2]?._type !== 'cell') return null
  const table = containers[t]
  const row = list(table.rows).findIndex(r => r._key === containers[t + 1]._key)
  const col = cellsOf(table, row).findIndex(c => c._key === containers[t + 2]._key)
  const tablePath = findNode(nodes, table._key as string)?.path
  return row === -1 || col === -1 || !tablePath ? null : { tablePath, table, row, col }
}

/** The cell after this one: the next in its row, else the first of the next row. Null at the last. */
export function nextCell(table: TreeNode, row: number, col: number): { row: number; col: number } | null {
  if (col + 1 < cellsOf(table, row).length) return { row, col: col + 1 }
  if (row + 1 < list(table.rows).length)   return { row: row + 1, col: 0 }
  return null
}

/** The cell before this one: the previous in its row, else the last of the previous row. Null at the first. */
export function previousCell(table: TreeNode, row: number, col: number): { row: number; col: number } | null {
  if (col > 0) return { row, col: col - 1 }
  if (row > 0) return { row: row - 1, col: Math.max(cellsOf(table, row - 1).length - 1, 0) }
  return null
}

/** The first text block in a cell, where the caret goes when Tab arrives; undefined when the cell holds none. */
export function firstBlockOf(table: TreeNode, row: number, col: number): TreeNode | undefined {
  let first: TreeNode | undefined
  walkBlocks(list(cellsOf(table, row)[col]?.content), b => { first ??= b as unknown as TreeNode })
  return first
}

export const emptyBlock = (newKey: () => string): TreeNode =>
  ({ _type: 'block', _key: newKey(), style: 'normal', markDefs: [], children: [{ _type: 'span', _key: newKey(), text: '', marks: [] }] })

export const emptyCell = (newKey: () => string): TreeNode => ({ _type: 'cell', _key: newKey(), content: [emptyBlock(newKey)] })

export const emptyRow = (newKey: () => string, cells: number): TreeNode =>
  ({ _type: 'row', _key: newKey(), cells: Array.from({ length: Math.max(cells, 1) }, () => emptyCell(newKey)) })

/** How many cells the widest row has. */
export const columnsOf = (table: TreeNode): number => Math.max(1, ...list(table.rows).map(r => list(r.cells).length))

/** The rows of the table with a new empty row after row `row`, as wide as the widest row. */
export function rowsWithRowAfter(table: TreeNode, row: number, newKey: () => string): { rows: TreeNode[]; added: TreeNode } {
  const rows = [...list(table.rows)]
  const added = emptyRow(newKey, columnsOf(table))
  rows.splice(row + 1, 0, added)
  return { rows, added }
}

/** The key of the first span of a text block, for a selection point. */
export const firstSpanKey = (block: TreeNode): string | undefined => {
  const first = list(block.children)[0]
  return isTextBlock(block) && typeof first?._key === 'string' ? first._key : undefined
}

/**
 * The rows with an empty paragraph put into the cell at `row`, `col` when it holds no text block (a description that
 * came from elsewhere may have one), so the caret has somewhere to go. The same rows, as the same objects, when it does.
 */
export function rowsWithBlockIn(table: TreeNode, row: number, col: number, newKey: () => string): TreeNode[] {
  if (firstBlockOf(table, row, col)) return table.rows as TreeNode[]
  return list(table.rows).map((r, i) => i !== row ? r : { ...r, cells: list(r.cells).map((c, j) => j !== col ? c : { ...c, content: [...list(c.content), emptyBlock(newKey)] }) })
}

/** The last text block in a cell; undefined when the cell holds none. */
export function lastBlockOf(table: TreeNode, row: number, col: number): TreeNode | undefined {
  let last: TreeNode | undefined
  walkBlocks(list(cellsOf(table, row)[col]?.content), b => { last = b as unknown as TreeNode })
  return last
}

/** The key of the last span of a text block, for telling whether the caret is at its end. */
export const lastSpanOf = (block: TreeNode): TreeNode | undefined => list(block.children).at(-1)
