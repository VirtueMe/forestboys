/**
 * Moving around a table of cells while editing, and growing it (#312). Pure: the editor's behaviours read the value,
 * ask here where to go or what the table should become, and send the editor that. A table is
 * `table › rows › row › cells › cell › content › blocks`; its cells are walked left to right, row by row.
 */

import { findNode, isTextBlock, siblingLists, walkBlocks, type PathSegment, type TreeNode } from './blockTree.ts'

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

/** What a structure edit makes of the table, and where the caret goes when its cell is gone (null: it stays where it is). */
export interface StructureEdit {
  rows:   TreeNode[]
  select: { row: number; col: number } | null
}

/** A new empty row above or below `row`, as wide as the widest. The caret stays in its cell: the cells keep their keys. */
export function addRow(table: TreeNode, row: number, where: 'above' | 'below', newKey: () => string): StructureEdit {
  const rows = [...list(table.rows)]
  rows.splice(where === 'above' ? row : row + 1, 0, emptyRow(newKey, columnsOf(table)))
  return { rows, select: null }
}

/** The table without `row`; null for its only row (the table goes instead). The caret goes to the same column of the row that took its place. */
export function deleteRow(table: TreeNode, row: number, col: number): StructureEdit | null {
  const all = list(table.rows)
  if (all.length < 2 || !all[row]) return null
  const rows = all.filter((_, i) => i !== row)
  const to = Math.min(row, rows.length - 1)
  return { rows, select: { row: to, col: Math.min(col, Math.max(list(rows[to].cells).length - 1, 0)) } }
}

/** A new empty cell before or after column `col` in every row; a row too short to have that column gets it at its end. */
export function addColumn(table: TreeNode, col: number, where: 'before' | 'after', newKey: () => string): StructureEdit {
  const at = where === 'before' ? col : col + 1
  const rows = list(table.rows).map(r => {
    const cells = [...list(r.cells)]
    cells.splice(Math.min(at, cells.length), 0, emptyCell(newKey))
    return { ...r, cells }
  })
  return { rows, select: null }
}

/**
 * The table without column `col`; null for its only column. The caret goes to the cell that took its place in the same
 * row. A row of one cell keeps it: a row with no cells is not a row (ingest refuses it).
 */
export function deleteColumn(table: TreeNode, col: number, row: number): StructureEdit | null {
  if (columnsOf(table) < 2) return null
  const rows = list(table.rows).map(r => list(r.cells).length < 2 ? r : { ...r, cells: list(r.cells).filter((_, j) => j !== col) })
  const cells = list(rows[row]?.cells)
  return { rows, select: { row: Math.min(row, rows.length - 1), col: Math.min(col, Math.max(cells.length - 1, 0)) } }
}

/** One option of a table the panel can change: the frame, the width, one of the two rules, or whether the text wraps. */
export type TableOption = { frame: 'none' | 'topBottom' | 'around' } | { width: 'compact' | 'full' } | { rowLines: boolean } | { columnLines: boolean } | { noWrap: boolean }

/**
 * What a change of one option does to the table's fields (#312): the default state is no field at all, so a plain
 * table stays plain data (`frame: 'none'`, `width: 'compact'`, `rowLines: false`, `noWrap: false` are never written), and what is not the default is written.
 * The page reads a missing field and a default one alike (src/utils/portableText.ts).
 */
export function optionEdit(change: TableOption): { set: Record<string, unknown>; unset: string[] } {
  const [field, value] = Object.entries(change)[0] as [string, unknown]
  const isDefault = value === 'none' || value === 'compact' || value === false
  return isDefault ? { set: {}, unset: [field] } : { set: { [field]: value }, unset: [] }
}

/** The frame a table has: a field that is not one of the known frames counts as none. */
export const frameOf = (table: TreeNode): 'none' | 'topBottom' | 'around' =>
  table.frame === 'topBottom' || table.frame === 'around' ? table.frame : 'none'

/** The width a table has: as wide as its content (compact), or the whole column (full); a missing or unknown one is compact. */
export const widthOf = (table: TreeNode): 'compact' | 'full' => table.width === 'full' ? 'full' : 'compact'

/** Is the node with `key` the last of its siblings, at the top or in a box? Nothing after it to put a caret in. */
export function isLastSibling(nodes: unknown, key: string): boolean {
  const list = siblingLists(nodes).find(l => l.list.some(n => n._key === key))?.list
  return !!list && list.at(-1)?._key === key
}

/** Does the table keep its text from wrapping? Only `noWrap: true` does; a missing or any other field wraps, as every table did. */
export const noWrapOf = (table: TreeNode): boolean => table.noWrap === true
