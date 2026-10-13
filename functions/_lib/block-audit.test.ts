import { describe, expect, it } from 'vitest'
import { auditBlocks, type SectionRow } from './block-audit.ts'

const span = (text: string, marks: string[] = []) => ({ _key: `s-${text}`, _type: 'span', text, marks })
const heading = (key: string, text: string, style = 'h3') => ({ _key: key, _type: 'block', style, markDefs: [], children: text ? [span(text)] : [] })
const para = (key: string, text = 'Tekst', marks: string[] = []) => ({ _key: key, _type: 'block', style: 'normal', markDefs: [], children: [span(text, marks)] })
const json = (...blocks: unknown[]) => JSON.stringify(blocks)

const row = (over: Partial<SectionRow>): SectionRow =>
  ({ label: 'Person', slug: 'p1', name: 'Per', rel: 'HAS_CONTENT', descId: 'd1', order: 1, content: json(para('a')), ...over })

describe('auditBlocks', () => {
  it('finds nothing in clean descriptions, and counts what it read', () => {
    const a = auditBlocks([row({}), row({ descId: 'd2', order: 2 })])
    expect(a.rows).toEqual([])
    expect(a.scanned).toBe(2)
  })

  it('says whose a finding is, and where to open it', () => {
    const a = auditBlocks([row({ label: 'Operation', slug: 'ax-13', name: 'AX 13', content: json(heading('h', '')) })])
    expect(a.rows).toHaveLength(1)
    expect(a.rows[0]).toMatchObject({ kind: 'empty-heading', blockKey: 'h', label: 'Operation', slug: 'ax-13', name: 'AX 13', path: '/events/ax-13', descId: 'd1' })
  })

  it('judges the sections of one entity as one outline, in order', () => {
    // Listed out of order on purpose: section 2 is read after section 1 whatever the rows' order.
    const a = auditBlocks([
      row({ descId: 'd2', order: 2, content: json(heading('b', 'Dypt', 'h5')) }),
      row({ descId: 'd1', order: 1, content: json(heading('a', 'Først', 'h3')) }),
    ])
    expect(a.rows.map(r => [r.kind, r.descId, r.blockKey])).toEqual([['heading-outline', 'd2', 'b']])
  })

  it('does not join the sections of two entities', () => {
    const a = auditBlocks([
      row({ slug: 'p1', descId: 'd1', content: json(heading('a', 'Først', 'h3')) }),
      row({ slug: 'p2', descId: 'd2', content: json(heading('b', 'Fra første', 'h3')) }),
    ])
    expect(a.rows).toEqual([])
  })

  it('a note on a relation gets the block findings, not the heading outline', () => {
    const a = auditBlocks([row({ rel: 'HAS_OPERATION_NOTE', content: json(heading('h', 'Tittel', 'h1'), para('p', 'x', ['m9'])) })])
    expect(a.rows.map(r => r.kind)).toEqual(['dangling-mark'])
  })

  it('a note does not join the outline of its entity\'s sections', () => {
    const a = auditBlocks([
      row({ descId: 'd1', order: 1, content: json(heading('a', 'Først', 'h3')) }),
      row({ descId: 'n1', order: 1, rel: 'HAS_INCIDENT_NOTE', content: json(heading('b', 'Dypt', 'h5')) }),
    ])
    expect(a.rows).toEqual([])
  })

  it('a card gets the block findings only, and opens in the admin editor of its page', () => {
    const a = auditBlocks([row({ label: 'Card', slug: null, name: 'Kort', pageSlug: 'home', cardId: 'c1', content: json(heading('h', '', 'h2'), para('p', 'x', ['m9'])) })])
    expect(a.rows.map(r => r.kind)).toEqual(['dangling-mark'])
    expect(a.rows[0].path).toBe('/admin/pages/home?card=c1')
  })

  it('puts what shows on the page first, then groups by kind and name', () => {
    const a = auditBlocks([
      row({ slug: 'a', name: 'A', descId: 'd1', content: json({ ...para('x'), markDefs: [{ _key: 'm', _type: 'link', href: '/x' }] }) }),   // unused definition
      row({ slug: 'b', name: 'B', descId: 'd2', content: json(para('y', 'første<br>andre')) }),                                              // typed markup
      row({ slug: 'c', name: 'C', descId: 'd3', content: json(heading('z', '')) }),                                                          // empty heading
      row({ slug: 'd', name: 'D', descId: 'd4', content: json(para('w', 'første<br>andre')) }),                                              // typed markup
    ])
    expect(a.rows.map(r => [r.kind, r.name])).toEqual([['empty-heading', 'C'], ['typed-markup', 'B'], ['typed-markup', 'D'], ['unused-definition', 'A']])
  })

  it('falls back to the slug, then the description id, for a name', () => {
    expect(auditBlocks([row({ name: '', content: json(heading('h', '')) })]).rows[0].name).toBe('p1')
    expect(auditBlocks([row({ name: '', slug: null, label: 'Card', content: json(heading('h', ''), para('p', 'a<br>b')) })]).rows[0].name).toBe('d1')
  })

  it('reads content that is missing or not JSON as no blocks', () => {
    expect(auditBlocks([row({ content: null }), row({ descId: 'd2', content: 'not json' })]).rows).toEqual([])
  })
})
