import { describe, expect, it } from 'vitest'
import { CAP_ROWS, capRows, describeRequest, normalizeQuery, requestKey, stableStringify } from './replay-key.ts'

describe('normalizeQuery', () => {
  it('collapses whitespace and trims, so formatting does not change the key', () => {
    expect(normalizeQuery('\n  MATCH (p:Person)\n    WHERE p.slug = $slug\n  RETURN p  ')).toBe('MATCH (p:Person) WHERE p.slug = $slug RETURN p')
  })
})

describe('stableStringify', () => {
  it('gives equal text for equal values, whatever the order of the keys, at any depth', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(stableStringify({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }))
  })
  it('keeps the order of arrays, which matters', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })
  it('writes undefined as null instead of failing', () => {
    expect(stableStringify(undefined)).toBe('null')
    expect(stableStringify({ a: 1 })).toBe('{"a":1}')
  })
})

describe('requestKey', () => {
  const q = 'MATCH (n {slug: $slug}) RETURN n'
  it('is the same for the same call written differently', () => {
    expect(requestKey(q, { slug: 'a', n: 1 })).toBe(requestKey(`  MATCH (n {slug: $slug})\n RETURN n `, { n: 1, slug: 'a' }))
  })
  it('differs when the parameters differ, or the query does, or when there are none', () => {
    expect(requestKey(q, { slug: 'a' })).not.toBe(requestKey(q, { slug: 'b' }))
    expect(requestKey(q, { slug: 'a' })).not.toBe(requestKey(q + ' LIMIT 1', { slug: 'a' }))
    expect(requestKey(q)).toBe(requestKey(q, {}))
    expect(requestKey(q)).not.toBe(requestKey(q, { slug: 'a' }))
  })
})

describe('describeRequest', () => {
  it('shortens a long query, and shows the parameters', () => {
    const text = describeRequest('MATCH ' + 'x'.repeat(200), { slug: 'a' })
    expect(text.startsWith('MATCH xxx')).toBe(true)
    expect(text).toContain('…')
    expect(text).toContain('{"slug":"a"}')
  })
})

describe('capRows', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ slug: `row-${String(i).padStart(4, '0')}` }))

  it('cuts a registry-wide query (no parameters) to its first rows and says how many there were', () => {
    const r = capRows('MATCH (p:Person) RETURN p', {}, rows(4000))
    expect(r.rows).toHaveLength(CAP_ROWS)
    expect(r.truncatedFrom).toBe(4000)
  })

  it('leaves a short registry query alone, and does not claim a cut', () => {
    const r = capRows('MATCH (p:Person) RETURN p', {}, rows(CAP_ROWS))
    expect(r.rows).toHaveLength(CAP_ROWS)
    expect('truncatedFrom' in r).toBe(false)
  })

  it('never cuts a query that has parameters: it is about the page', () => {
    const r = capRows('MATCH (p:Person {slug: $slug})-[:X]->(e) RETURN e', { slug: 'a' }, rows(500))
    expect(r.rows).toHaveLength(500)
    expect('truncatedFrom' in r).toBe(false)
  })

  it('keeps the same rows however the graph happened to order them, so a recording does not change by itself', () => {
    const forwards = rows(300)
    const shuffled = [...forwards].sort((a, b) => (a.slug.charCodeAt(5) * 7 + a.slug.length) - (b.slug.charCodeAt(5) * 7 + b.slug.length) || (a.slug < b.slug ? 1 : -1))
    expect(capRows('q', {}, shuffled).rows).toEqual(capRows('q', {}, forwards).rows)
  })

  it('also keeps the rows that mention the page itself, wherever they were, so the page can find itself', () => {
    const r = capRows('q', {}, rows(300), 'row-0250')
    expect(r.rows).toHaveLength(CAP_ROWS + 1)
    expect(r.rows).toContainEqual({ slug: 'row-0250' })
  })
})
