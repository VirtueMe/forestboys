import { describe, expect, it } from 'vitest'
import { linkArchiveBlocks, tnaSearchUrl } from './archiveRefs.ts'

interface Span { _key: string; _type: string; text: string; marks: string[] }
interface Block { _key: string; _type: string; children: Span[]; markDefs: { _key: string; _type: string; href?: string; slug?: string }[] }

const span = (_key: string, text: string, marks: string[] = []): Span => ({ _key, _type: 'span', text, marks })
const block = (children: Span[], markDefs: Block['markDefs'] = []): Block => ({ _key: 'b1', _type: 'block', children, markDefs })

/** Link the references in one span of text; the spans and mark defs that come out. */
function run(text: string, marks: string[] = []) {
  const [b] = linkArchiveBlocks([block([span('s1', text, marks)])])
  return b
}

/** The text of the spans that carry a link mark, and what each one searches for. */
function links(b: Block) {
  return b.children
    .map(c => ({ c, def: b.markDefs.find(d => c.marks.includes(d._key) && d._type === 'link' && d.href) }))
    .filter(x => x.def)
    .map(x => ({ text: x.c.text, q: decodeURIComponent(new URL(x.def!.href!).searchParams.get('_q')!) }))
}

describe('tnaSearchUrl', () => {
  it("is Jan's search with the piece and item as the text", () => {
    expect(tnaSearchUrl('1068', '2')).toBe(
      'https://discovery.nationalarchives.gov.uk/results/r?_q=AIR%2027%2F1068-2&_col=200&_cr1=AIR%2027&_dss=range&_sd=1940&_ed=1945&_hb=tna&_rv=simple',
    )
  })
  it('searches the piece alone when there is no item', () => {
    expect(tnaSearchUrl('1649')).toContain('_q=AIR%2027%2F1649&')
  })
})

describe('linkArchiveBlocks', () => {
  it('links the reference only; the page stays plain text beside it', () => {
    const b = run('Se AIR-27-2159-22 p24.')
    expect(b.children.map(c => c.text)).toEqual(['Se ', 'AIR-27-2159-22', ' p24.'])
    expect(links(b)).toEqual([{ text: 'AIR-27-2159-22', q: 'AIR 27/2159-22' }])
  })

  it('stores an ordinary link mark def (the shape Sanity uses)', () => {
    const b = run('AIR-27-1068-2')
    expect(b.markDefs).toEqual([{ _key: 'tna-s1-0', _type: 'link', href: tnaSearchUrl('1068', '2') }])
    expect(b.children[0].marks).toEqual(['tna-s1-0'])
  })

  it('links a reference with no item', () => {
    expect(links(run('AIR-27-2165 p64'))).toEqual([{ text: 'AIR-27-2165', q: 'AIR 27/2165' }])
  })

  it('accepts lower case, a space and a slash', () => {
    expect(links(run('Air-27-1167-14 p5'))[0].q).toBe('AIR 27/1167-14')
    expect(links(run('AIR 27/1068-2'))[0].q).toBe('AIR 27/1068-2')
  })

  it('stops at the tab before the page, and at a page written with a space', () => {
    expect(links(run('AIR-27-956-8\tp6'))[0].text).toBe('AIR-27-956-8')
    expect(links(run('AIR-27-1723-32 s 6'))[0].text).toBe('AIR-27-1723-32')
  })

  it('ignores a _2 volume suffix when searching (Jan)', () => {
    expect(links(run('AIR-27-1649_2'))).toEqual([{ text: 'AIR-27-1649_2', q: 'AIR 27/1649' }])
    expect(links(run('AIR-27-1649_1'))[0].q).toBe('AIR 27/1649')
  })

  it('ignores a +24 second item when searching (Jan)', () => {
    expect(links(run('AIR-27-1908-23+24'))).toEqual([{ text: 'AIR-27-1908-23+24', q: 'AIR 27/1908-23' }])
  })

  it('ignores a second page after a slash (Jan)', () => {
    const b = run('AIR-27-1068-2 p345 / 365')
    expect(links(b)).toEqual([{ text: 'AIR-27-1068-2', q: 'AIR 27/1068-2' }])
    expect(b.children.at(-1)!.text).toBe(' p345 / 365')
  })

  it('links every reference in a span, in a tab-aligned roster', () => {
    const b = run('AIR-27-2159-22 p24\tAIR-27-2165 p64\nAIR-27-1649_2 p56')
    expect(links(b).map(l => l.q)).toEqual(['AIR 27/2159-22', 'AIR 27/2165', 'AIR 27/1649'])
    expect(b.children.map(c => c.text).join('')).toBe('AIR-27-2159-22 p24\tAIR-27-2165 p64\nAIR-27-1649_2 p56')
  })

  it('keeps the other marks on the linked piece (Jan writes these bold and underlined)', () => {
    const b = run('AIR-27-2159-22 p24', ['strong', 'underline'])
    expect(b.children.map(c => c.marks)).toEqual([['strong', 'underline', 'tna-s1-0'], ['strong', 'underline']])
  })

  it('gives every span a key of its own', () => {
    const keys = run('a AIR-27-1-1 b AIR-27-2-2 c').children.map(c => c._key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys[0]).toBe('s1')
  })

  it('leaves a span that is already a link, or a person, alone', () => {
    const link = block([span('s1', 'AIR-27-2159-22', ['m1'])], [{ _key: 'm1', _type: 'link', href: 'https://example.org/x' }])
    const person = block([span('s1', 'AIR-27-2159-22', ['p1'])], [{ _key: 'p1', _type: 'person', slug: 'x' }])
    const input = [link, person]
    expect(linkArchiveBlocks(input)).toBe(input)
  })

  it('links a span whose link mark has no address (it is not a link on the page)', () => {
    const dead = block([span('s1', 'AIR-27-2159-22', ['m1'])], [{ _key: 'm1', _type: 'link' }])
    expect(links(linkArchiveBlocks([dead])[0])).toHaveLength(1)
  })

  it('leaves the other series alone (Jan: AIR 27 only for now)', () => {
    for (const t of ['HS2-235', 'HS9-1439-7', 'HS 8/12', 'AIR-20-1068', 'AIR-27']) {
      const input = [block([span('s1', t)])]
      expect(linkArchiveBlocks(input)).toBe(input)
    }
  })

  it('does not match inside a longer word or number', () => {
    for (const t of ['CHAIR-27-1068', 'AIR-27-1068x', 'AIR-27-1068-2-3']) {
      const input = [block([span('s1', t)])]
      expect(linkArchiveBlocks(input)).toBe(input)
    }
  })

  it('is the same on a second run — the same input always gives the same output', () => {
    const once = linkArchiveBlocks([block([span('s1', 'Se AIR-27-2159-22 p24 og AIR-27-1649_2.')])])
    expect(linkArchiveBlocks(once)).toBe(once)
    const again = linkArchiveBlocks([block([span('s1', 'Se AIR-27-2159-22 p24 og AIR-27-1649_2.')])])
    expect(JSON.stringify(again)).toBe(JSON.stringify(once))
  })

  it('returns the input itself when there is nothing to link', () => {
    const input = [block([span('s1', 'Ingen referanse')]), { _key: 'i', _type: 'image' }]
    expect(linkArchiveBlocks(input)).toBe(input)
  })

  it('passes anything that is not a list of blocks through', () => {
    expect(linkArchiveBlocks(null)).toBeNull()
    expect(linkArchiveBlocks(undefined)).toBeUndefined()
    expect(linkArchiveBlocks('text')).toBe('text')
  })

  it('does not change what it is given', () => {
    const input = [block([span('s1', 'AIR-27-1068-2')])]
    const before = JSON.stringify(input)
    linkArchiveBlocks(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
