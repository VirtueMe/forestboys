import { describe, expect, it } from 'vitest'
import type { TreeNode } from './blockTree.ts'
import { cellTexts, guessSeparator, linesOf, tableFromBlocks, type TextBlock } from './textTable.ts'

const counter = () => { let n = 0; return () => `k${++n}` }
const span = (text: string, marks: string[] = []) => ({ _key: `s${text}`, _type: 'span', text, marks })
const block = (text: string, extra: Partial<TextBlock> = {}): TextBlock =>
  ({ _type: 'block', _key: `b${text}`, style: 'normal', markDefs: [], children: [span(text)], ...extra })
const texts = (blocks: TextBlock[], sep: Parameters<typeof tableFromBlocks>[1], header = false) =>
  cellTexts(tableFromBlocks(blocks, sep, header, counter())!)

describe('guessSeparator', () => {
  it('prefers a tab, then runs of spaces, then ; and |', () => {
    expect(guessSeparator(['a\tb', 'c\td'])).toBe('tab')
    expect(guessSeparator(['a   b', 'c   d'])).toBe('spaces')
    expect(guessSeparator(['a;b', 'c;d'])).toBe('semicolon')
    expect(guessSeparator(['a|b', 'c|d'])).toBe('pipe')
    expect(guessSeparator(['a\tb;c', 'd\te;f'])).toBe('tab')
  })

  it('needs the separator in at least half of the lines that have anything in them', () => {
    expect(guessSeparator(['a   b', 'prose line', '', 'c   d'])).toBe('spaces')
    expect(guessSeparator(['a   b', 'one', 'two', 'three'])).toBeNull()
  })

  it('does not take a single space for columns, and gives null for nothing', () => {
    expect(guessSeparator(['a b c', 'd e f'])).toBeNull()
    expect(guessSeparator([])).toBeNull()
    expect(guessSeparator(['', '  '])).toBeNull()
  })
})

describe('tableFromBlocks', () => {
  it('makes a row of each block and a cell of each piece', () => {
    expect(texts([block('1\tMartin\tOslo'), block('2\tEva\tBergen')], 'tab'))
      .toEqual([['1', 'Martin', 'Oslo'], ['2', 'Eva', 'Bergen']])
  })

  it('reads runs of 2+ spaces as columns and keeps a single space inside a cell', () => {
    expect(texts([block('Martin Linge   Oslo   1940')], 'spaces')).toEqual([['Martin Linge', 'Oslo', '1940']])
  })

  it('reads the padding of an old fixed-width table: a run of spaces of any width is one separator', () => {
    const aligned = ['Nr  Navn            By', '1   Martin Linge    Oslo', '12  Eva              Bergen']
    expect(guessSeparator(aligned)).toBe('spaces')
    expect(texts(aligned.map(l => block(l, { style: 'preformatted' })), 'spaces'))
      .toEqual([['Nr', 'Navn', 'By'], ['1', 'Martin Linge', 'Oslo'], ['12', 'Eva', 'Bergen']])
  })

  it('reads the lines of consecutive fixed-width blocks kept in one block with line breaks', () => {
    expect(texts([block('a    b\nc  d', { style: 'preformatted' })], 'spaces')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('does not make a column of an indent or of trailing spaces', () => {
    expect(texts([block('   a   b   ')], 'spaces')).toEqual([['a', 'b']])
  })

  it('splits on ; and |, and takes a | at the edge of the line for a frame', () => {
    expect(texts([block('a; b ;c')], 'semicolon')).toEqual([['a', 'b', 'c']])
    expect(texts([block('| a | b |')], 'pipe')).toEqual([['a', 'b']])
  })

  it('keeps an empty piece between tabs as an empty cell', () => {
    expect(texts([block('a\t\tc')], 'tab')).toEqual([['a', '', 'c']])
  })

  it('makes a row of each line in a block with line breaks', () => {
    expect(texts([block('a\tb\nc\td')], 'tab')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('leaves out a line with nothing in it', () => {
    expect(texts([block('a\tb\n\n  \nc\td')], 'tab')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('pads a short row with empty cells so the columns line up', () => {
    const t = tableFromBlocks([block('a\tb\tc'), block('d')], 'tab', false, counter())!
    expect(cellTexts(t)).toEqual([['a', 'b', 'c'], ['d', '', '']])
    for (const row of t.rows as TreeNode[]) for (const cell of row.cells as TreeNode[]) expect((cell.content as unknown[]).length).toBe(1)
  })

  it('gives null when no line has anything in it', () => {
    expect(tableFromBlocks([block(' '), block('')], 'tab', false, counter())).toBeNull()
  })

  it('keeps marks and links on the words they were on, cut where the piece is cut', () => {
    const b = block('', {
      markDefs: [{ _key: 'l1', _type: 'link', href: 'https://example.com' } as never, { _key: 'unused', _type: 'link' } as never],
      children: [span('Ann\tse ', []), span('Bergen', ['strong', 'l1']), span('\t1940', ['em'])],
    })
    const t = tableFromBlocks([b], 'tab', false, counter())!
    const cell = (i: number) => ((t.rows as TreeNode[])[0].cells as TreeNode[])[i].content as TextBlock[]
    expect(cellTexts(t)).toEqual([['Ann', 'se Bergen', '1940']])
    expect(cell(1)[0].children!.map(c => [c.text, c.marks])).toEqual([['se ', []], ['Bergen', ['strong', 'l1']]])
    expect(cell(1)[0].markDefs!.map(d => d._key)).toEqual(['l1'])
    expect(cell(0)[0].markDefs).toEqual([])
    expect(cell(2)[0].children![0].marks).toEqual(['em'])
  })

  it('makes a cell paragraph of a heading, keeps a quote, and gives every node a key of its own', () => {
    const t = tableFromBlocks([block('a\tb', { style: 'h3' }), block('c\td', { style: 'blockquote' })], 'tab', false, counter())!
    const styles = (t.rows as TreeNode[]).map(r => ((r.cells as TreeNode[])[0].content as TextBlock[])[0].style)
    expect(styles).toEqual(['normal', 'blockquote'])
    const keys: string[] = []
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (n && typeof n === 'object') { const o = n as Record<string, unknown>; if (typeof o._key === 'string') keys.push(o._key); Object.values(o).forEach(walk) }
    }
    walk(t)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('makes the first row bold with a header, and only the first', () => {
    const t = tableFromBlocks([block('Navn\tBy'), block('Ann\tOslo')], 'tab', true, counter())!
    const marks = (row: number, col: number) => (((t.rows as TreeNode[])[row].cells as TreeNode[])[col].content as TextBlock[])[0].children![0].marks
    expect(marks(0, 0)).toEqual(['strong'])
    expect(marks(0, 1)).toEqual(['strong'])
    expect(marks(1, 0)).toEqual([])
  })

  it('keeps an inline object in the piece it was in, and does not count it as a separator', () => {
    const person = { _key: 'p1', _type: 'person', ref: 'x' }
    const b = block('', { children: [span('a\t'), person, span(' b')] })
    const t = tableFromBlocks([b], 'tab', false, counter())!
    const second = ((t.rows as TreeNode[])[0].cells as TreeNode[])[1].content as TextBlock[]
    expect(second[0].children!.map(c => c._type)).toEqual(['person', 'span'])
  })
})

describe('linesOf', () => {
  it('lists the lines of the blocks, line breaks included', () => {
    expect(linesOf([block('a\nb'), block('c')])).toEqual(['a', 'b', 'c'])
  })
})
