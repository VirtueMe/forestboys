/**
 * Text that has columns in it, made into a table (#328): lines from a scan, separated by tabs, runs of spaces, `;` or `|`.
 * Pure: the editor hands in text blocks and gets a `table` container back (src/utils/tableNav.ts has the other table logic).
 */

import type { TreeNode } from './blockTree.ts'
import { emptyCell } from './tableNav.ts'

export type Separator = 'tab' | 'spaces' | 'semicolon' | 'pipe'

/** In the order they are guessed. */
export const SEPARATORS: readonly Separator[] = ['tab', 'spaces', 'semicolon', 'pipe']

/** Standing in for an inline object (a person, say) in the text the splitter reads: one character, never a separator. */
const OBJECT = '￼'

type Range = [number, number]
type Child = { _key: string; _type: string; text?: string; marks?: string[] } & Record<string, unknown>
export type TextBlock = TreeNode & { children?: Child[]; markDefs?: { _key: string }[]; style?: string }

const PATTERNS: Record<Separator, RegExp> = {
  tab:       /\t/g,
  spaces:    /[ \u00a0]{2,}/g,
  semicolon: /;/g,
  pipe:      /\|/g,
}

/** The text of a block as the splitter reads it: spans as written, any other inline thing as one placeholder. */
export const flatText = (block: TextBlock): string =>
  (block.children ?? []).map(c => (c._type === 'span' ? c.text ?? '' : OBJECT)).join('')

const trimmed = (text: string, [from, to]: Range): Range => {
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--
  return [from, to]
}

/** The lines of a block's text: a line break in a paragraph is a row of its own. */
function lineRanges(text: string): Range[] {
  const out: Range[] = []
  let from = 0
  for (const m of text.matchAll(/\n/g)) { out.push([from, m.index]); from = m.index + 1 }
  out.push([from, text.length])
  return out
}

/**
 * The pieces of one line. Tabs and `;` keep an empty piece (an empty cell); runs of spaces are read from the trimmed line,
 * so an indent is not a column; a `|` at either edge of the line is a frame, not a column.
 */
function pieceRanges(text: string, line: Range, sep: Separator): Range[] {
  const [start, end] = sep === 'spaces' ? trimmed(text, line) : line
  const pieces: Range[] = []
  let from = start
  for (const m of text.slice(start, end).matchAll(PATTERNS[sep])) {
    pieces.push([from, start + m.index])
    from = start + m.index + m[0].length
  }
  pieces.push([from, end])
  const cut = pieces.map(r => trimmed(text, r))
  if (sep === 'pipe') {
    if (cut.length > 1 && cut[0][0] === cut[0][1]) cut.shift()
    if (cut.length > 1 && cut.at(-1)![0] === cut.at(-1)![1]) cut.pop()
  }
  return cut
}

const hasSeparator = (line: string, sep: Separator): boolean =>
  sep === 'spaces' ? /\S[ \u00a0]{2,}\S/.test(line) : new RegExp(PATTERNS[sep].source).test(line)

/**
 * The separator the lines most likely use: the first of tab, runs of spaces, `;`, `|` that is in at least half of the
 * lines that have anything in them. Null when none is, and the person picks.
 */
export function guessSeparator(lines: string[]): Separator | null {
  const filled = lines.filter(l => l.trim() !== '')
  if (!filled.length) return null
  return SEPARATORS.find(sep => {
    const n = filled.filter(l => hasSeparator(l, sep)).length
    return n > 0 && n * 2 >= filled.length
  }) ?? null
}

/** Every line of the blocks, a line break inside a block included. */
export const linesOf = (blocks: TextBlock[]): string[] =>
  blocks.flatMap(block => { const text = flatText(block); return lineRanges(text).map(([from, to]) => text.slice(from, to)) })

/** A new text block holding the characters `[from, to)` of `block`: its spans cut to the range, with their marks and links. */
function pieceBlock(block: TextBlock, [from, to]: Range, newKey: () => string): TextBlock {
  const children: Child[] = []
  let at = 0
  for (const child of block.children ?? []) {
    if (child._type === 'span') {
      const text = child.text ?? ''
      const a = Math.max(from, at), b = Math.min(to, at + text.length)
      if (a < b) children.push({ ...child, _key: newKey(), text: text.slice(a - at, b - at) })
      at += text.length
    } else {
      if (at >= from && at < to) children.push({ ...child, _key: newKey() })
      at += 1
    }
  }
  if (!children.length) children.push({ _key: newKey(), _type: 'span', text: '', marks: [] })
  const used = new Set(children.flatMap(c => c.marks ?? []))
  return {
    _type: 'block', _key: newKey(),
    style: block.style === 'blockquote' ? 'blockquote' : 'normal',   // a cell holds no headings
    markDefs: (block.markDefs ?? []).filter(d => used.has(d._key)),
    children,
  }
}

const bold = (block: TextBlock): TextBlock => ({
  ...block,
  children: (block.children ?? []).map(c => (c._type === 'span' && !(c.marks ?? []).includes('strong') ? { ...c, marks: [...(c.marks ?? []), 'strong'] } : c)),
})

/**
 * The table for these text blocks: a row for every line that has anything in it, a cell for every piece, a short row padded
 * with empty cells so the columns line up. With `header` the first row is bold. Null when no line has anything in it.
 */
export function tableFromBlocks(blocks: TextBlock[], sep: Separator, header: boolean, newKey: () => string): TreeNode | null {
  const rows: TextBlock[][] = []
  for (const block of blocks) {
    const text = flatText(block)
    for (const line of lineRanges(text)) {
      const pieces = pieceRanges(text, line, sep)
      if (pieces.every(([a, b]) => a === b)) continue
      rows.push(pieces.map(r => pieceBlock(block, r, newKey)))
    }
  }
  if (!rows.length) return null
  const columns = Math.max(...rows.map(r => r.length))
  return {
    _type: 'table', _key: newKey(),
    rows: rows.map((cells, i) => ({
      _type: 'row', _key: newKey(),
      cells: [
        ...cells.map(b => ({ _type: 'cell', _key: newKey(), content: [i === 0 && header ? bold(b) : b] })),
        ...Array.from({ length: columns - cells.length }, () => emptyCell(newKey)),
      ],
    })),
  }
}

/** The text of every cell of a table made by `tableFromBlocks`, row by row: what the panel previews. */
export const cellTexts = (table: TreeNode): string[][] =>
  (table.rows as TreeNode[]).map(row => (row.cells as TreeNode[]).map(cell => ((cell.content as TextBlock[]) ?? []).map(flatText).join(' ')))
