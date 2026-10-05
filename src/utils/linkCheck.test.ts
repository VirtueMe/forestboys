import { describe, expect, it } from 'vitest'
import { buildIndex, checkLinks, problems } from './linkCheck.ts'

const INDEX = buildIndex([
  { label: 'Operation', slug: 'sub004' },
  { label: 'Incident', slug: 'crash-at-x' },
  { label: 'Operation', slug: 'mtb-x37' },
  { label: 'Operation', slug: 'boac-2' },
  { label: 'Operation', slug: 'boac-02' },
  { label: 'Operation', slug: 'new-name' },
  { label: 'Operation', slug: 'old-name', target: 'new-name' },   // renamed
  { label: 'Person', slug: 'john-rognes' },
  { label: 'Location', slug: 'lamholmen' },
  { label: 'Outline', slug: 'usaaf' },
])

/** One block with one link mark over `text`. */
const link = (href: string | undefined, text = 'her') => [{
  _key: 'b1', _type: 'block',
  markDefs: [{ _key: 'm1', _type: 'link', ...(href === undefined ? {} : { href }) }],
  children: [{ _key: 's1', _type: 'span', text: 'Se ' }, { _key: 's2', _type: 'span', text, marks: ['m1'] }],
}]

const person = (slug: string) => [{
  _key: 'b1', _type: 'block',
  markDefs: [{ _key: 'p1', _type: 'person', slug, name: 'N' }],
  children: [{ _key: 's1', _type: 'span', text: 'Rognes', marks: ['p1'] }],
}]

const verdict = (href: string | undefined) => checkLinks(link(href), INDEX)[0]

describe('checkLinks', () => {
  it('passes a bare slug that is an event', () => {
    expect(verdict('sub004')).toMatchObject({ verdict: 'ok', text: 'her', stored: 'sub004' })
  })

  it('treats an incident as an event page', () => {
    expect(verdict('crash-at-x').verdict).toBe('ok')
  })

  it('passes a ../kind/slug path whose target exists', () => {
    expect(verdict('../outlines/usaaf').verdict).toBe('ok')
    expect(verdict('../locations/lamholmen').verdict).toBe('ok')
  })

  it('ignores spaces around the target', () => {
    expect(verdict(' sub004 ').verdict).toBe('ok')
  })

  it('suggests the real page when the spelling differs', () => {
    expect(verdict('SUB004')).toMatchObject({ verdict: 'fixable', suggestion: { path: '/events/sub004' } })
    expect(verdict('mtb-x037')).toMatchObject({ verdict: 'fixable', suggestion: { path: '/events/mtb-x37' } })
  })

  it('suggests the real kind when a bare slug is a person', () => {
    expect(verdict('john-rognes')).toMatchObject({ verdict: 'fixable', suggestion: { path: '/person/john-rognes', label: 'Person' } })
  })

  it('suggests the real kind when a ../ path names the wrong one', () => {
    expect(verdict('../people/lamholmen')).toMatchObject({ verdict: 'fixable', suggestion: { path: '/map/lamholmen' } })
  })

  it('suggests the new slug when the target was renamed', () => {
    expect(verdict('old-name')).toMatchObject({ verdict: 'fixable', suggestion: { path: '/events/new-name', slug: 'new-name' } })
  })

  it('is ambiguous when two pages fit equally well', () => {
    const f = verdict('boac-002')
    expect(f.verdict).toBe('ambiguous')
    expect(f.candidates?.map(c => c.slug).sort()).toEqual(['boac-02', 'boac-2'])
  })

  it('is broken when no page fits', () => {
    expect(verdict('soe-station-thrush').verdict).toBe('broken')
    expect(verdict('../outlines/nothing').verdict).toBe('broken')
  })

  it('is empty when the link has no target', () => {
    expect(verdict(undefined).verdict).toBe('empty')
    expect(verdict('  ').verdict).toBe('empty')
  })

  it('does not report external or mail links', () => {
    expect(verdict('https://example.com/x')).toBeUndefined()
    expect(verdict('mailto:a@b.no')).toBeUndefined()
  })

  it('checks /kind/slug paths and leaves other paths alone', () => {
    expect(verdict('/person/john-rognes').verdict).toBe('ok')
    expect(verdict('/person/nobody').verdict).toBe('broken')
    expect(verdict('/about')).toBeUndefined()
  })

  it('checks person marks against people only', () => {
    expect(checkLinks(person('john-rognes'), INDEX)[0].verdict).toBe('ok')
    expect(checkLinks(person('sub004'), INDEX)[0]).toMatchObject({ verdict: 'fixable', source: 'person' })
    expect(checkLinks(person('nobody'), INDEX)[0].verdict).toBe('broken')
  })

  it('reads the JSON string a Description stores', () => {
    expect(checkLinks(JSON.stringify(link('nothing-here')), INDEX)[0].verdict).toBe('broken')
    expect(checkLinks('not json', INDEX)).toEqual([])
    expect(checkLinks(null, INDEX)).toEqual([])
  })

  it('skips a mark no text uses', () => {
    const blocks = link('nothing-here', '')
    expect(checkLinks(blocks, INDEX)).toEqual([])
  })

  it('problems() keeps everything that is not ok', () => {
    const both = [...link('sub004'), { ...link('gone')[0], _key: 'b2' }]
    expect(checkLinks(both, INDEX)).toHaveLength(2)
    expect(problems(checkLinks(both, INDEX)).map(f => f.stored)).toEqual(['gone'])
  })
})
