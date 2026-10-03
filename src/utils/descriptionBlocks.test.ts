import { describe, expect, it } from 'vitest'
import { descriptionBlocks } from './descriptionBlocks'

const block = (text: string) => ({ _type: 'block', children: [{ _type: 'span', text }] })

describe('descriptionBlocks', () => {
  it('joins the blocks of each row, in row order', () => {
    const rows = [
      { content: JSON.stringify([block('a'), block('b')]) },
      { content: JSON.stringify([block('c')]) },
    ]
    expect(descriptionBlocks(rows)).toEqual([block('a'), block('b'), block('c')])
  })

  it('skips empty, null and malformed rows', () => {
    const rows = [{ content: null }, { content: '' }, { content: '{not json' }, { content: JSON.stringify([block('ok')]) }]
    expect(descriptionBlocks(rows)).toEqual([block('ok')])
  })

  it('ignores rows that are valid JSON but not a list of blocks', () => {
    expect(descriptionBlocks([{ content: '{"a":1}' }, { content: '"text"' }, { content: '3' }])).toEqual([])
  })

  it('returns an empty list for no rows', () => {
    expect(descriptionBlocks([])).toEqual([])
  })
})
