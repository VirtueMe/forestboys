import { describe, expect, it } from 'vitest'
import { COMMENT_ID_RE, COMMENT_MAX, countComments, totalComments, validateComment } from './bundleComments.ts'

describe('validateComment', () => {
  it('takes a bundle comment, trimmed', () => {
    expect(validateComment({ type: 'bundle', text: '  Testbundle  ' })).toEqual({ type: 'bundle', text: 'Testbundle' })
  })

  it('takes an entity comment with its entity', () => {
    expect(validateComment({ type: 'entity', entityId: 'Unit:kompani-linge', text: 'Kildene må sjekkes.' }))
      .toEqual({ type: 'entity', entityId: 'Unit:kompani-linge', text: 'Kildene må sjekkes.' })
  })

  it('refuses an entity comment without an entity, and a bundle comment with one', () => {
    expect(validateComment({ type: 'entity', text: 'x' })).toContain('entityId required')
    expect(validateComment({ type: 'bundle', entityId: 'Unit:a', text: 'x' })).toContain('no entityId')
  })

  it('refuses an entity that is not in the bundle', () => {
    expect(validateComment({ type: 'entity', entityId: 'Unit:b', text: 'x' }, ['Unit:a'])).toContain('not in this bundle')
    expect(validateComment({ type: 'entity', entityId: 'Unit:a', text: 'x' }, ['Unit:a'])).toMatchObject({ entityId: 'Unit:a' })
  })

  it('refuses an unknown scope, an empty text and a text that is too long', () => {
    expect(validateComment({ type: 'op', text: 'x' })).toContain('type must be')
    expect(validateComment({ type: 'bundle', text: '   ' })).toBe('text required')
    expect(validateComment({ type: 'bundle', text: 'x'.repeat(COMMENT_MAX + 1) })).toContain('longer than')
    expect(validateComment(null)).toBe('a comment is an object')
  })
})

describe('countComments', () => {
  it('counts each scope and each entity from the refs alone', () => {
    const c = countComments([
      { id: 'a', type: 'bundle' },
      { id: 'b', type: 'entity', entityId: 'Unit:a' },
      { id: 'c', type: 'entity', entityId: 'Unit:a' },
      { id: 'd', type: 'entity', entityId: 'Unit:b' },
    ])
    expect(c).toEqual({ bundle: 1, entities: { 'Unit:a': 2, 'Unit:b': 1 } })
    expect(totalComments(c)).toBe(4)
  })
  it('is empty for no comments', () => expect(totalComments(countComments([]))).toBe(0))
})

describe('the comment id', () => {
  it('is a time and a short suffix', () => {
    expect(COMMENT_ID_RE.test('2026-10-08T07:30:00.870Z-02cc')).toBe(true)
    expect(COMMENT_ID_RE.test('../manifest')).toBe(false)
  })
})
