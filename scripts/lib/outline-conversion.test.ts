import { describe, expect, it } from 'vitest'
import { makeEntitySnapshot } from '../../functions/_lib/bundle-package.ts'
import { validateBundle } from '../../functions/_lib/bundle-validate.ts'
import {
  buildArchive, buildOutlineBundle, checkAgainstArchive, classifyInbound, type Conversion, type OutlineBundleBody, type OutlineGroup,
} from './outline-conversion.ts'

const NOW  = '2026-10-07T12:00:00.000Z'
const SITE = 'https://archive.example'
const BLOCKS = JSON.stringify([{ _type: 'block', _key: 'a', children: [{ _type: 'span', _key: 's', text: 'Tekst.' }] }])

const unit: OutlineGroup = {
  outlineSlug: 'linge-medlemmer',
  outlineSha:  'a'.repeat(64),
  entity: makeEntitySnapshot({
    kind: 'Unit', key: 'kompani-linge',
    props: { canonicalName: 'Kompani Linge', type: 'company', sanityOutlineId: 'o1', sanityId: 'u1', sanityUpdatedAt: 'x' },
    descriptions: [{ order: 1, content: BLOCKS }],
    edges: [{ type: 'PART_OF', to: 'Organization:soe' }],
    source: { site: SITE, path: '/outlines/kompani-linge' },
  }),
  inbound: [
    { from: 'Person:ole-nilsen', type: 'MEMBER_OF', to: 'Unit:kompani-linge', props: { state: 'verified', sourceRef: 'linge-outline-membership' } },
    { from: 'Person:ola-hansen', type: 'MEMBER_OF', to: 'Unit:kompani-linge', props: { state: 'verified', sourceRef: 'linge-outline-membership' } },
    { from: 'Unit:linge-course-a', type: 'PART_OF', to: 'Unit:kompani-linge' },
  ],
}
const article: OutlineGroup = {
  outlineSlug: 'code-names', outlineSha: 'b'.repeat(64),
  entity: makeEntitySnapshot({
    kind: 'Article', key: 'code-names', props: { title: 'Code names', author: 'jan' },
    descriptions: [{ order: 1, content: BLOCKS }], edges: [], source: { site: SITE, path: '/article/code-names' },
  }),
  inbound: [],
}
const conversion = (...groups: OutlineGroup[]): Conversion => ({ groups, unlinked: [], raw: { nodes: [], edges: [] } })

describe('buildOutlineBundle', () => {
  const body = buildOutlineBundle(unit, NOW)

  it('is an outline bundle: the slug and the hash of the text, and says no bot made it', () => {
    expect(body.outlineId).toBe('linge-medlemmer')
    expect(body.outlineRev).toBe('a'.repeat(64))
    expect(body.bundleId).toBe(`bundle:linge-medlemmer:${NOW}`)
    expect(body.model).toBe('none')
    expect(body.promptHash).toBe('none')
  })

  it('creates the entity with its props, description and outbound edges, without bookkeeping', () => {
    const first = body.entities[0] as { entityId: string; ops: Record<string, unknown>[]; derivedFrom: unknown }
    expect(first.entityId).toBe('Unit:kompani-linge')
    expect(first.ops).toEqual([{
      op: 'create-entity', kind: 'Unit', slug: 'kompani-linge',
      props: { canonicalName: 'Kompani Linge', type: 'company' },
      edges: [{ type: 'PART_OF', to: 'Organization:soe' }],
      descriptions: [{ order: 1, content: BLOCKS }],
    }])
    expect(first.derivedFrom).toEqual({ outlineId: 'linge-medlemmer', outlineRev: 'a'.repeat(64) })
  })

  it('makes the edges into the entity ops on the entity they leave, one entity each', () => {
    const rest = body.entities.slice(1) as { entityId: string; ops: unknown[] }[]
    expect(rest.map(e => e.entityId)).toEqual(['Person:ola-hansen', 'Person:ole-nilsen', 'Unit:linge-course-a'])
    expect(rest[0].ops).toEqual([{ op: 'add-edge', type: 'MEMBER_OF', from: 'Person:ola-hansen', to: 'Unit:kompani-linge', props: { state: 'verified', sourceRef: 'linge-outline-membership' } }])
    expect(rest[2].ops).toEqual([{ op: 'add-edge', type: 'PART_OF', from: 'Unit:linge-course-a', to: 'Unit:kompani-linge' }])
  })

  it('passes what ingest checks', () => {
    expect(typeof validateBundle(body)).toBe('object')
    expect(typeof validateBundle(buildOutlineBundle(article, NOW))).toBe('object')
  })

  it('names no Sanity id or revision', () => {
    expect(JSON.stringify(body)).not.toMatch(/sanity|_rev/i)
  })
})

describe('checkAgainstArchive', () => {
  const c = conversion(unit, article)
  const archive = buildArchive(c, SITE, NOW)
  const bundles = () => c.groups.map(g => buildOutlineBundle(g, NOW))

  it('finds nothing when the bundles hold what the archive holds', () => {
    expect(checkAgainstArchive(archive, bundles())).toEqual([])
  })

  it('keeps the archive free of bookkeeping: a package of snapshots, the inbound edges beside it', () => {
    expect(archive.package.entities.map(e => `${e.kind}:${e.key}`)).toEqual(['Article:code-names', 'Unit:kompani-linge'])
    expect(archive.inbound).toHaveLength(3)
    expect(JSON.stringify(archive.package)).not.toMatch(/sanity/i)
  })

  const mutate = (f: (b: OutlineBundleBody[]) => void) => { const b = JSON.parse(JSON.stringify(bundles())) as OutlineBundleBody[]; f(b); return checkAgainstArchive(archive, b) }
  type Ent = { ops: { props?: Record<string, unknown>; descriptions?: unknown[]; edges?: unknown[] }[] }
  const unitBundle = (b: OutlineBundleBody[]) => b.find(x => x.outlineId === 'linge-medlemmer')!

  it('compares values, not the order of keys', () => {
    expect(mutate(b => { const p = (unitBundle(b).entities[0] as Ent).ops[0].props!; const r = Object.fromEntries(Object.entries(p).reverse()); (unitBundle(b).entities[0] as Ent).ops[0].props = r })).toEqual([])
  })

  it('finds a prop, a description or an edge that differs', () => {
    expect(mutate(b => { (unitBundle(b).entities[0] as Ent).ops[0].props!.canonicalName = 'Annet' })).toEqual(['Unit:kompani-linge: props differ from the archive'])
    expect(mutate(b => { (unitBundle(b).entities[0] as Ent).ops[0].descriptions = [] })).toEqual(['Unit:kompani-linge: descriptions differ from the archive'])
    expect(mutate(b => { (unitBundle(b).entities[0] as Ent).ops[0].edges = [] })).toEqual(['Unit:kompani-linge: edges differ from the archive'])
  })

  it('finds a missing inbound edge and a missing bundle', () => {
    const lost = mutate(b => { unitBundle(b).entities.splice(1, 1) })
    expect(lost.some(p => p.includes('inbound edge ops'))).toBe(true)
    expect(lost.some(p => p.includes('Person:ola-hansen -MEMBER_OF-> Unit:kompani-linge') || p.includes('Person:ole-nilsen'))).toBe(true)
    expect(mutate(b => { b.pop() })).toEqual(['code-names: no bundle'])
  })

  it('finds a bundle ingest would refuse, and a Sanity id that got in', () => {
    expect(mutate(b => { (unitBundle(b).entities[1] as { entityId: string }).entityId = 'Person:Has Space' })[0]).toMatch(/ingest would refuse/)
    expect(mutate(b => { (unitBundle(b).entities[0] as Ent).ops[0].props!.sanityId = 'x' })).toContain('a Sanity id or revision is in the package or a bundle')
  })
})

describe('classifyInbound', () => {
  const person = (slug: string) => ({ fromLabels: ['Person'], fromProps: { slug } })

  it('makes an op of an edge from an entity', () => {
    expect(classifyInbound({ ...person('ole-nilsen'), type: 'MEMBER_OF', props: { sourceRef: 'linge-outline-membership' } })).toEqual({ reason: null, from: 'Person:ole-nilsen' })
    expect(classifyInbound({ fromLabels: ['Unit'], fromProps: { slug: 'linge-course-a' }, type: 'PART_OF', props: {} })).toEqual({ reason: null, from: 'Unit:linge-course-a' })
  })
  it('leaves out an edge from something that is no entity', () => {
    expect(classifyInbound({ fromLabels: ['Description'], fromProps: { id: 'desc:x' }, type: 'ABOUT_UNIT', props: {} })).toEqual({ reason: 'not-entity', from: null })
  })
  it('leaves out an edge from an entity whose slug has a trailing space', () => {
    expect(classifyInbound({ ...person('alf-aakre '), type: 'MEMBER_OF', props: { sourceRef: 'linge-outline-membership' } })).toEqual({ reason: 'bad-slug', from: 'Person:alf-aakre ' })
  })
  it('drops a person\'s MEMBER_OF without the import\'s sourceRef, and only that', () => {
    expect(classifyInbound({ ...person('martin-jensen-linge'), type: 'MEMBER_OF', props: {} })).toEqual({ reason: 'not-ours', from: 'Person:martin-jensen-linge' })
    expect(classifyInbound({ fromLabels: ['Unit'], fromProps: { slug: 'x' }, type: 'MEMBER_OF', props: {} }).reason).toBeNull()
    expect(classifyInbound({ ...person('ole'), type: 'PART_OF', props: {} }).reason).toBeNull()
  })
})
