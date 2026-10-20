/**
 * A table on the clipboard, made into table containers (#328): the `<table>` of Word or a web page, or the tab-separated
 * rows of Excel. The browser parts (DOMParser) are covered by the e2e specs; the tab-separated path is pure.
 */

import type { TreeNode } from './blockTree.ts'
import { emptyCell, emptyBlock } from './tableNav.ts'
import { cellTexts, guessSeparator, linesOf, tableFromBlocks, type TextBlock } from './textTable.ts'

type Span = { _key: string; _type: 'span'; text: string; marks: string[] }

/** Elements that end the paragraph they are in and start another. */
const BLOCKS = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'td', 'th', 'table', 'thead', 'tbody', 'tfoot'])
const SKIPPED = new Set(['script', 'style', 'title', 'meta', 'link', 'head', 'xml'])
const DECORATOR_OF: Record<string, string> = { b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'underline' }

/** The paragraphs of a cell: its text with bold, italic, underline and links kept, a block element or more starting a paragraph. */
function cellBlocks(cell: Element, newKey: () => string, bold: boolean): TextBlock[] {
  const blocks: TextBlock[] = []
  let spans: Span[] = []
  let defs: { _key: string; _type: string; href: string }[] = []

  const flush = () => {
    const merged: Span[] = []
    for (const s of spans) {
      const last = merged.at(-1)
      if (last && last.marks.join() === s.marks.join()) last.text += s.text
      else merged.push({ ...s })
    }
    if (merged.length) {
      merged[0].text = merged[0].text.replace(/^\s+/, '')
      merged.at(-1)!.text = merged.at(-1)!.text.replace(/\s+$/, '')
    }
    const children = merged.filter(s => s.text !== '')
    if (children.length) {
      const used = new Set(children.flatMap(c => c.marks))
      blocks.push({ _type: 'block', _key: newKey(), style: 'normal', markDefs: defs.filter(d => used.has(d._key)), children })
    }
    spans = []
    defs = []
  }

  const walk = (node: Node, marks: string[]): void => {
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? '').replace(/[\s\u00a0]+/g, ' ')
      if (text) spans.push({ _key: newKey(), _type: 'span', text, marks })
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = el.nodeName.toLowerCase()
    if (SKIPPED.has(tag)) return
    if (tag === 'br') { spans.push({ _key: newKey(), _type: 'span', text: '\n', marks }); return }
    let next = marks
    const decorator = DECORATOR_OF[tag]
    if (decorator && !marks.includes(decorator)) next = [...marks, decorator]
    if (tag === 'a' && el.getAttribute('href')) {
      const def = { _key: newKey(), _type: 'link', href: el.getAttribute('href')! }
      defs.push(def)
      next = [...next, def._key]
    }
    const isBlock = BLOCKS.has(tag)
    if (isBlock) flush()
    el.childNodes.forEach(c => walk(c, next))
    if (isBlock) flush()
  }

  cell.childNodes.forEach(c => walk(c, bold ? ['strong'] : []))
  flush()
  return blocks.length ? blocks : [emptyBlock(newKey)]
}

/** One `<table>` as a table container: a row for each `<tr>`, a cell for each `<td>`/`<th>`, short rows padded. */
function tableFromElement(table: HTMLTableElement, newKey: () => string): TreeNode | null {
  const rows: TreeNode[][] = []
  for (const tr of Array.from(table.rows)) {
    const cells: TreeNode[] = []
    for (const cell of Array.from(tr.cells)) {
      cells.push({ _type: 'cell', _key: newKey(), content: cellBlocks(cell, newKey, cell.nodeName.toLowerCase() === 'th') })
      for (let i = 1; i < Math.min(cell.colSpan, 20); i++) cells.push(emptyCell(newKey))
    }
    if (cells.length) rows.push(cells)
  }
  if (!rows.length) return null
  const columns = Math.max(...rows.map(r => r.length))
  return {
    _type: 'table', _key: newKey(),
    rows: rows.map(cells => ({
      _type: 'row', _key: newKey(),
      cells: [...cells, ...Array.from({ length: columns - cells.length }, () => emptyCell(newKey))],
    })),
  }
}

/**
 * The tables of a piece of HTML, when it is tables and nothing else (a page's text around a table is left to the ordinary
 * paste, which makes paragraphs of it). Only the outermost tables count; Word and Excel wrap theirs in styles and comments,
 * which are not text.
 */
export function tablesFromHtml(html: string, newKey: () => string): TreeNode[] | null {
  if (!/<table[\s>]/i.test(html)) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tables = Array.from(doc.body.querySelectorAll('table')).filter(t => !t.parentElement?.closest('table'))
  if (!tables.length) return null
  const rest = doc.body.cloneNode(true) as HTMLElement
  rest.querySelectorAll('table, style, script').forEach(el => el.remove())
  if ((rest.textContent ?? '').replace(/[\s\u00a0]+/g, '') !== '') return null
  const made = tables.map(t => tableFromElement(t, newKey)).filter((t): t is TreeNode => !!t)
  // One cell copied from Excel arrives as a table of one cell: that is a word, not a table.
  const isOneCell = (t: TreeNode) => (t.rows as TreeNode[]).length === 1 && (t.rows as TreeNode[])[0].cells && ((t.rows as TreeNode[])[0].cells as unknown[]).length === 1
  return made.length && !made.every(isOneCell) ? made : null
}

/**
 * Tab-separated text (Excel, Sheets, a text file) as a table, when it has more than one line and most lines have a tab.
 * One line with a tab in it stays text: a tab can be only a tab. Quoted cells with line breaks in them are not read.
 */
export function tableFromTabs(text: string, newKey: () => string): TreeNode | null {
  const block: TextBlock = { _type: 'block', _key: newKey(), style: 'normal', markDefs: [], children: [{ _key: newKey(), _type: 'span', text, marks: [] }] }
  const lines = linesOf([block]).filter(l => l.trim() !== '')
  if (lines.length < 2 || guessSeparator(lines) !== 'tab') return null
  const table = tableFromBlocks([block], 'tab', false, newKey)
  // Tabs only at the edges of the lines make no second column.
  return table && cellTexts(table).some(row => row.slice(1).some(text => text !== '')) ? table : null
}

/** The tables a paste holds: those of its HTML, else the tab-separated rows of its text. Null when it holds none. */
export function tablesFromClipboard(data: { html: string; text: string }, newKey: () => string): TreeNode[] | null {
  const fromHtml = data.html ? tablesFromHtml(data.html, newKey) : null
  if (fromHtml) return fromHtml
  const fromTabs = data.text ? tableFromTabs(data.text, newKey) : null
  return fromTabs ? [fromTabs] : null
}
