import { describe, expect, it } from 'vitest'
import { blocksToHtml, type SanityBlock } from '../../src/utils/portableText.ts'
import { markPreformatted, wasDrawnAsTable } from './preformatted-blocks.ts'

const block = (text: string, over: Partial<SanityBlock> = {}): SanityBlock =>
  ({ _key: 'k', _type: 'block', style: 'normal', markDefs: [], children: [{ _key: 's', _type: 'span', text, marks: [] }], ...over })

const PROSE = 'A long sentence of plain prose that goes on well past a hundred characters without any tab or padding in it.'

describe('wasDrawnAsTable', () => {
  it('is a paragraph with a tab', () => {
    expect(wasDrawnAsTable(block('1.\tPoints arising'))).toBe(true)
    expect(wasDrawnAsTable(block('a\tb', { style: undefined }))).toBe(true)
  })
  it('is not a paragraph without a tab, or with prose beside the tabs', () => {
    expect(wasDrawnAsTable(block('no tab here'))).toBe(false)
    expect(wasDrawnAsTable(block(`(a)\tItem\n${PROSE}`))).toBe(false)
  })
  it('is not a heading, a quote, a list item or another type', () => {
    expect(wasDrawnAsTable(block('a\tb', { style: 'h3' }))).toBe(false)
    expect(wasDrawnAsTable(block('a\tb', { style: 'blockquote' }))).toBe(false)
    expect(wasDrawnAsTable(block('a\tb', { listItem: 'bullet', level: 1 }))).toBe(false)
    expect(wasDrawnAsTable({ _key: 'i', _type: 'image' })).toBe(false)
  })
})

describe('markPreformatted', () => {
  const before = [block('Intro.'), block('a\tb'), block('c\td'), block(`x\ty\n${PROSE}`), block('Head', { style: 'h3' })]

  it('sets the style on the table blocks and nothing else, and counts them', () => {
    const { blocks, marked } = markPreformatted(before)
    expect(marked).toBe(2)
    expect(blocks.map(b => b.style)).toEqual(['normal', 'preformatted', 'preformatted', 'normal', 'h3'])
    expect(blocks[0]).toBe(before[0])
    expect(blocks[1].children).toEqual(before[1].children)
  })

  it('is idempotent', () => {
    const once = markPreformatted(before).blocks
    expect(markPreformatted(once)).toEqual({ blocks: once, marked: 0 })
  })

  it('draws the same HTML as the renderer did before, so nothing changes visibly', () => {
    const drawnBefore = blocksToHtml(before)
    expect(blocksToHtml(markPreformatted(before).blocks)).toBe(drawnBefore)
  })
})
