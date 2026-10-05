import { describe, expect, it } from 'vitest'
import { auditDescriptions, type DescriptionRow } from './link-audit.ts'

const SLUGS = [
  { label: 'Operation', slug: 'sub004' },
  { label: 'Person', slug: 'john-rognes' },
]

const content = (...hrefs: string[]) => JSON.stringify(hrefs.map((href, i) => ({
  _key: `b${i}`, _type: 'block',
  markDefs: [{ _key: 'm', _type: 'link', href }],
  children: [{ _key: 's', _type: 'span', text: `lenke ${i}`, marks: ['m'] }],
})))

const desc = (over: Partial<DescriptionRow>): DescriptionRow =>
  ({ label: 'Operation', slug: 'ax-13', name: 'AX 13', descId: 'd1', order: 1, content: null, ...over })

describe('auditDescriptions', () => {
  it('lists only the links that are not fine, with whose they are', () => {
    const a = auditDescriptions(SLUGS, [desc({ content: content('sub004', 'gone') })])
    expect(a.checked).toBe(2)
    expect(a.rows).toHaveLength(1)
    expect(a.rows[0]).toMatchObject({
      verdict: 'broken', stored: 'gone', text: 'lenke 1',
      label: 'Operation', slug: 'ax-13', name: 'AX 13', path: '/events/ax-13', descId: 'd1',
    })
  })

  it('puts the worst first, then groups by kind and name', () => {
    const a = auditDescriptions(SLUGS, [
      desc({ descId: 'd1', content: content('SUB004') }),                    // fixable
      desc({ descId: 'd2', name: 'B', content: content('gone') }),           // broken
      desc({ descId: 'd3', name: 'A', label: 'Person', slug: 'p', content: content('gone') }),
    ])
    expect(a.rows.map(r => r.descId)).toEqual(['d2', 'd3', 'd1'])
  })

  it('counts a description with no links, or bad JSON, as scanned only', () => {
    const a = auditDescriptions(SLUGS, [desc({ content: null }), desc({ content: 'not json' })])
    expect(a).toEqual({ rows: [], scanned: 2, checked: 0 })
  })

  it('sends a home-page card to the admin editor of its page', () => {
    const a = auditDescriptions(SLUGS, [
      desc({ label: 'Card', slug: null, name: 'Innledning', descId: 'desc:home:2', pageSlug: 'home', cardId: 'card:home:2', content: content('gone') }),
    ])
    expect(a.rows[0].path).toBe('/admin/pages/home?card=card%3Ahome%3A2')
  })

  it('has no page for an owner without a slug or a known kind', () => {
    const a = auditDescriptions(SLUGS, [
      desc({ slug: null, name: null, descId: 'x', content: content('gone') }),
      desc({ label: 'Role', slug: 'pilot', name: 'Pilot', descId: 'y', content: content('gone') }),
    ])
    expect(a.rows.map(r => [r.descId, r.path, r.name])).toEqual([['x', null, 'x'], ['y', null, 'Pilot']])
  })
})
