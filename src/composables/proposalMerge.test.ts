import { describe, expect, it } from 'vitest'
import type { Section } from '@/components/SectionsEditor.vue'
import { applyModifyBlockOps, computeExpectedShas, stableShaBrowser } from './proposalMerge.ts'
import type { BundleOp, EntityPayload, PtNode } from './useProposalBundle.ts'

const blocks = (text: string, key = 'k1') => JSON.stringify([{ _type: 'block', _key: key, children: [{ _type: 'span', _key: 's', text }] }])
const section = (order: number, content: string): Section => ({ order, content, citations: [], sourcedFrom: null })
const payload = (...ops: BundleOp[]): EntityPayload => ({
  entityId: 'Transport:mtb-683', ops,
  derivedFrom: { source: { site: 'https://a.example', path: '/transport/mtb-683' } }, source: 's', generatedAt: 'now',
})

describe('applyModifyBlockOps: the text ops of a payload, in the preview', () => {
  it('replaces the whole text of the section a set-description names', () => {
    const sections = [section(1, blocks('Gammel tekst.')), section(2, blocks('Uberørt.', 'k2'))]
    const n = applyModifyBlockOps(payload({ op: 'set-description', order: 1, expectedSha: 'x', content: blocks('Ny tekst.') }), sections)
    expect(n).toBe(1)
    expect(sections.map(s => s.content)).toEqual([blocks('Ny tekst.'), blocks('Uberørt.', 'k2')])
  })

  it('adds the section when there is none of that order, as the apply creates the description', () => {
    const sections = [section(1, blocks('En.'))]
    applyModifyBlockOps(payload({ op: 'set-description', order: 2, expectedSha: '', content: blocks('To.', 'k2') }), sections)
    expect(sections.map(s => [s.order, s.citations, s.sourcedFrom])).toEqual([[1, [], null], [2, [], null]])
    expect(sections[1].content).toBe(blocks('To.', 'k2'))
  })

  it('still replaces a block by its key, as before', () => {
    const sections = [section(1, blocks('Gammel.'))]
    const newValue = { _type: 'block' as const, _key: 'k1', children: [{ _type: 'span', _key: 's', text: 'Ny.' }] }
    expect(applyModifyBlockOps(payload({ op: 'modify-block', blockPath: 'section.bio.block.k1', expectedSha: '', newValue }), sections)).toBe(1)
    expect(sections[0].content).toBe(JSON.stringify([newValue]))
  })

  it('does nothing for the ops that are not text', () => {
    const sections = [section(1, blocks('Uendret.'))]
    expect(applyModifyBlockOps(payload({ op: 'set-props', props: { a: { from: 1, to: 2 } } }), sections)).toBe(0)
    expect(sections[0].content).toBe(blocks('Uendret.'))
  })
})

describe('a container is one block in the preview (#315)', () => {
  const text = (key: string, t: string) => ({ _type: 'block', _key: key, children: [{ _type: 'span', _key: `${key}s`, text: t }] })
  const table = (cellText: string) => ({ _type: 'table' as const, _key: 'tab1', rows: [{ _type: 'row', _key: 'r1', cells: [{ _type: 'cell', _key: 'c1', content: [text('x', cellText)] }] }] })
  const live = () => JSON.stringify([text('a', 'før'), table('Gammel'), text('z', 'etter')])
  const op = (newValue: PtNode): BundleOp => ({ op: 'modify-block', blockPath: 'section.crew.block.tab1', expectedSha: '', newValue })

  it('replaces the whole container by its key and leaves the blocks around it', () => {
    const sections = [section(1, live())]
    expect(applyModifyBlockOps(payload(op(table('Ny'))), sections)).toBe(1)
    expect(JSON.parse(sections[0].content)).toEqual([text('a', 'før'), table('Ny'), text('z', 'etter')])
  })

  it('hashes the whole container for the drift check, so a change in a cell is a change', async () => {
    const before = await computeExpectedShas(payload(op(table('Ny'))), [section(1, live())])
    expect(before['section.crew.block.tab1']).toBe(await stableShaBrowser(table('Gammel')))
    const after = await computeExpectedShas(payload(op(table('Ny'))), [section(1, JSON.stringify([table('Endret')]))])
    expect(after['section.crew.block.tab1']).not.toBe(before['section.crew.block.tab1'])
  })
})
