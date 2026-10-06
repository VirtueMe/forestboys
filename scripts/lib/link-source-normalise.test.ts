import { describe, expect, it } from 'vitest'
import { urlToId } from './person-rule.ts'
import { planNormalise } from './link-source-normalise.ts'

const padded = (url: string, owners = 1) => ({ id: urlToId(url), url, owners })

describe('planNormalise', () => {
  it('deletes a Source nothing refers to, twin or not', () => {
    const p = padded('https://a.example/x ', 0)
    expect(planNormalise([p], [p.id])).toEqual([{ kind: 'delete', id: p.id }])
    expect(planNormalise([p], [p.id, urlToId('https://a.example/x')])).toEqual([{ kind: 'delete', id: p.id }])
  })

  it('renames a Source whose trimmed address has no Source yet', () => {
    const p = padded('https://a.example/x ')
    expect(planNormalise([p], [p.id])).toEqual([
      { kind: 'rename', id: p.id, to: urlToId('https://a.example/x'), url: 'https://a.example/x' },
    ])
  })

  it('merges into the twin when the trimmed address already has a Source', () => {
    const p = padded('https://a.example/x\t')
    const twin = urlToId('https://a.example/x')
    expect(planNormalise([p], [p.id, twin])).toEqual([{ kind: 'merge', id: p.id, into: twin }])
  })

  it('renames one and merges the rest when several pad the same address', () => {
    const a = padded('https://a.example/x '), b = padded('https://a.example/x  ')
    const to = urlToId('https://a.example/x')
    expect(planNormalise([a, b], [a.id, b.id])).toEqual([
      { kind: 'rename', id: a.id, to, url: 'https://a.example/x' },
      { kind: 'merge', id: b.id, into: to },
    ])
  })

  it('leaves alone what is not an http(s) address once trimmed', () => {
    expect(planNormalise([{ id: 'x', url: ' ftp://a.example ', owners: 1 }], ['x'])).toEqual([
      { kind: 'skip', id: 'x', reason: 'not an http(s) address once trimmed' },
    ])
  })
})
