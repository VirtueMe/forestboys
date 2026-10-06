import { describe, expect, it } from 'vitest'
import { linkTextRange, selectionTextRange, splitMarks } from './linkText.ts'

const span = (key: string, text: string, marks: string[] = []) => ({ _key: key, _type: 'span', text, marks })
const block = (...children: ReturnType<typeof span>[]) => ({
  _key: 'b1', _type: 'block', markDefs: [{ _key: 'm1', _type: 'link', href: '/x' }], children,
})

describe('linkTextRange', () => {
  it('reads the words of a link in one span', () => {
    const r = linkTextRange(block(span('s1', 'Se '), span('s2', 'her', ['m1'])), 'm1')
    expect(r).toEqual({ startKey: 's2', startOffset: 0, endKey: 's2', endOffset: 3, text: 'her', marks: ['m1'], editable: true })
  })

  it('is editable when the link spans several spans with the same marks', () => {
    const r = linkTextRange(block(span('s1', 'a', ['m1']), span('s2', 'b', ['m1'])), 'm1')
    expect(r).toMatchObject({ startKey: 's1', endKey: 's2', endOffset: 1, text: 'ab', editable: true })
  })

  it('is read-only when part of the link is bold', () => {
    const r = linkTextRange(block(span('s1', 'a ', ['m1']), span('s2', 'b', ['m1', 'strong'])), 'm1')
    expect(r).toMatchObject({ text: 'a b', editable: false })
  })

  it('is null for a mark that covers nothing', () => {
    expect(linkTextRange(block(span('s1', 'Se ')), 'm1')).toBeNull()
  })
})

describe('selectionTextRange', () => {
  const b = block(span('s1', 'Se '), span('s2', 'her', ['strong']), span('s3', ' nå'))

  it('reads a selection inside one span', () => {
    expect(selectionTextRange(b, { spanKey: 's1', offset: 0 }, { spanKey: 's1', offset: 2 }))
      .toEqual({ startKey: 's1', startOffset: 0, endKey: 's1', endOffset: 2, text: 'Se', marks: [], editable: true })
  })

  it('reads a backward selection', () => {
    expect(selectionTextRange(b, { spanKey: 's1', offset: 2 }, { spanKey: 's1', offset: 0 })?.text).toBe('Se')
  })

  it('is read-only across spans with different marks', () => {
    const r = selectionTextRange(b, { spanKey: 's1', offset: 1 }, { spanKey: 's2', offset: 2 })
    expect(r).toMatchObject({ startKey: 's1', startOffset: 1, endKey: 's2', endOffset: 2, text: 'e he', editable: false })
  })

  it('ignores an empty piece at the edge of the selection', () => {
    const r = selectionTextRange(b, { spanKey: 's1', offset: 3 }, { spanKey: 's2', offset: 3 })
    expect(r).toMatchObject({ startKey: 's2', text: 'her', editable: true })
  })

  it('is null for a caret', () => {
    expect(selectionTextRange(b, { spanKey: 's1', offset: 1 }, { spanKey: 's1', offset: 1 })).toBeNull()
  })
})

describe('splitMarks', () => {
  it('separates decorators from annotations and keeps the annotation values', () => {
    expect(splitMarks(block(), ['strong', 'm1'])).toEqual({
      decorators:  ['strong'],
      annotations: [{ name: 'link', value: { href: '/x' }, key: 'm1' }],
    })
  })
})
