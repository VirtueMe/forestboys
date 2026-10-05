import { describe, expect, it } from 'vitest'
import { buildIndex } from '../../src/utils/linkCheck.ts'
import { judgeLinks } from './link-guard.ts'

const INDEX = buildIndex([
  { label: 'Operation', slug: 'sub004' },
  { label: 'Operation', slug: 'boac-2' },
  { label: 'Operation', slug: 'boac-02' },
  { label: 'Person', slug: 'john-rognes' },
])

const desc = (...hrefs: (string | undefined)[]) => JSON.stringify(hrefs.map((href, i) => ({
  _key: `b${i}`, _type: 'block',
  markDefs: [{ _key: `m${i}`, _type: 'link', ...(href === undefined ? {} : { href }) }],
  children: [{ _key: 's', _type: 'span', text: `lenke ${i}`, marks: [`m${i}`] }],
})))

describe('judgeLinks', () => {
  it('lets a save through when every link leads somewhere', () => {
    expect(judgeLinks([], [desc('sub004', 'john-rognes')], INDEX)).toEqual({ blocked: [], warnings: [
      expect.objectContaining({ stored: 'john-rognes', verdict: 'fixable' }),   // a person written as a bare slug
    ] })
  })

  it('refuses a new link that leads nowhere', () => {
    const r = judgeLinks([], [desc('sub004', 'gone')], INDEX)
    expect(r.blocked).toEqual([{ source: 'link', text: 'lenke 1', stored: 'gone', verdict: 'broken' }])
    expect(r.warnings).toEqual([])
  })

  it('refuses a new link with no target, and an ambiguous one', () => {
    expect(judgeLinks([], [desc(undefined)], INDEX).blocked[0].verdict).toBe('empty')
    const a = judgeLinks([], [desc('boac-002')], INDEX).blocked[0]
    expect(a.verdict).toBe('ambiguous')
    expect(a.candidates?.map(c => c.slug).sort()).toEqual(['boac-02', 'boac-2'])
  })

  it('leaves a link that was already there, and warns about it', () => {
    const before = desc('gone')
    const r = judgeLinks([before], [before], INDEX)
    expect(r.blocked).toEqual([])
    expect(r.warnings).toEqual([{ source: 'link', text: 'lenke 0', stored: 'gone', verdict: 'broken' }])
  })

  it('treats an old link with its target changed as new', () => {
    expect(judgeLinks([desc('gone')], [desc('gone-too')], INDEX).blocked).toHaveLength(1)
  })

  it('does not mind spaces around an old target, or moving it to another place', () => {
    expect(judgeLinks([desc('gone')], [desc('sub004', ' gone ')], INDEX).blocked).toEqual([])
  })

  it('saves a new fixable link and warns with the page it should name', () => {
    const r = judgeLinks([], [desc('SUB004')], INDEX)
    expect(r.blocked).toEqual([])
    expect(r.warnings[0]).toMatchObject({ verdict: 'fixable', suggestion: { path: '/events/sub004' } })
  })

  it('does not take a bad person link for a bad plain link', () => {
    const person = JSON.stringify([{ _key: 'b', _type: 'block', markDefs: [{ _key: 'p', _type: 'person', slug: 'gone' }],
      children: [{ _key: 's', _type: 'span', text: 'N', marks: ['p'] }] }])
    expect(judgeLinks([desc('gone')], [person], INDEX).blocked).toHaveLength(1)
  })

  it('has nothing to say about a description without links', () => {
    expect(judgeLinks([], ['[]', 'not json'], INDEX)).toEqual({ blocked: [], warnings: [] })
  })
})
