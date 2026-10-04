import { describe, expect, it } from 'vitest'
import { FIELDS, classify, stampFor, stampsFromBaseline, verifyStamps, type Doc, type GraphPerson } from './person-sync.ts'

const person = (over: Partial<GraphPerson> = {}): GraphPerson => ({
  sanityId: 'p1', sanityUpdatedAt: '2026-04-01', slug: 'ola-nordmann', canonicalName: 'Ola Nordmann',
  secretName: null, home: 'Oslo', birthYear: 1920, status: null, statusSourceRef: null,
  serviceClass: null, serviceClassSourceRef: null, type: null, links: [], linkIds: [], images: [], imageIds: [],
  knownRank: null, content: [], stamps: {}, adminEdited: [], rels: 0, graphOnlyRels: 0, ...over,
})

const sanityDoc = (over: Record<string, unknown> = {}): Doc =>
  ({ _id: 'p1', _updatedAt: '2026-05-01', name: 'Ola Nordmann', home: 'Oslo', birthYear: 1920, slug: { current: 'ola-nordmann' }, ...over })

const home = FIELDS.find(f => f.name === 'home')!
const verdictOf = (g: GraphPerson, s: Doc, april?: Doc) => classify(g, s, april).find(v => v.field === 'home')?.verdict

describe('classify without a baseline file (CI)', () => {
  it('sends a changed field with no stamp to review, never to an automatic apply', () => {
    expect(verdictOf(person(), sanityDoc({ home: 'Bergen' }))).toBe('review')
  })

  it('is a conflict when the editor saved that field and there is no baseline', () => {
    expect(verdictOf(person({ adminEdited: ['home'] }), sanityDoc({ home: 'Bergen' }))).toBe('conflict')
  })

  it('has nothing to say about a field where the graph already equals Sanity', () => {
    expect(verdictOf(person(), sanityDoc())).toBeUndefined()
  })
})

describe('classify from the stamps alone', () => {
  const stamped = (over: Partial<GraphPerson> = {}) => person({ stamps: stampFor(home, sanityDoc()), ...over })

  it('does nothing while Sanity still hashes to the stamp', () => {
    expect(verdictOf(stamped(), sanityDoc())).toBeUndefined()
  })

  it('is clean when Sanity changed and the graph still holds the stamped value', () => {
    expect(verdictOf(stamped(), sanityDoc({ home: 'Bergen' }))).toBe('clean')
  })

  it('is a conflict when the graph was edited since the stamp', () => {
    expect(verdictOf(stamped({ home: 'Trondheim' }), sanityDoc({ home: 'Bergen' }))).toBe('conflict')
  })

  it('is already when the graph holds the new value', () => {
    expect(verdictOf(stamped({ home: 'Bergen' }), sanityDoc({ home: 'Bergen' }))).toBe('already')
  })

  it('gives the same verdict with or without the baseline file once the field is stamped', () => {
    const g = stamped()
    const s = sanityDoc({ home: 'Bergen' })
    const april = sanityDoc({ _updatedAt: g.sanityUpdatedAt! })
    expect(verdictOf(g, s, april)).toBe(verdictOf(g, s, undefined))
  })
})

describe('stampFor', () => {
  it('stamps the hash of the Sanity value, and of what the rule makes of it only when that differs', () => {
    const out = stampFor(home, sanityDoc())
    expect(Object.keys(out)).toEqual(['home_sha'])
    const name = FIELDS.find(f => f.name === 'name')!
    expect(Object.keys(stampFor(name, sanityDoc({ name: 'Kaptein Ola Nordmann' })))).toContain('name_graphSha')
  })
})

describe('stampsFromBaseline', () => {
  const april = (over: Record<string, unknown> = {}) => sanityDoc({ _updatedAt: '2026-04-01', ...over })

  it('stamps every field when the baseline is the version the graph took in', () => {
    const out = stampsFromBaseline(person(), april())
    for (const f of FIELDS) expect(out).toHaveProperty(`${f.name}_sha`)
  })

  it('stamps nothing when the baseline is not that version, or there is none', () => {
    expect(stampsFromBaseline(person({ sanityUpdatedAt: '2026-04-02' }), april())).toEqual({})
    expect(stampsFromBaseline(person(), undefined)).toEqual({})
  })

  it('leaves a field that already has a stamp alone', () => {
    const out = stampsFromBaseline(person({ stamps: { home_sha: 'kept' } }), april())
    expect(out).not.toHaveProperty('home_sha')
    expect(out).toHaveProperty('birthYear_sha')
  })

  it('stamps what the rule makes of the baseline, not what the graph holds now, so an edit stays visible', () => {
    const edited = person({ home: 'Trondheim' })
    const out = stampsFromBaseline(edited, april())
    expect(out.home_sha).toBe(stampFor(home, april()).home_sha)
  })
})

describe('verifyStamps: the stamps give the verdicts the baseline file gives', () => {
  const aprilDoc = sanityDoc({ _updatedAt: '2026-04-01' })
  const check = (g: GraphPerson, s: Doc) => verifyStamps(new Map([[g.sanityId, g]]), new Map([[s._id, s]]), new Map([[aprilDoc._id, aprilDoc]]))
  const text = [{ _type: 'block', children: [{ _type: 'span', text: 'En beskrivelse' }] }]

  it.each([
    ['nothing changed in Sanity', person(), sanityDoc({ _updatedAt: '2026-04-01' })],
    ['Sanity changed, the graph still holds the baseline', person(), sanityDoc({ home: 'Bergen' })],
    ['Sanity changed, the graph was edited', person({ home: 'Trondheim' }), sanityDoc({ home: 'Bergen' })],
    ['Sanity changed, the graph already has the new value', person({ home: 'Bergen' }), sanityDoc({ home: 'Bergen' })],
    ['several fields changed at once', person(), sanityDoc({ home: 'Bergen', birthYear: 1921, secretName: 'X' })],
    ['a description the graph never imported, unchanged in Sanity', person(), sanityDoc({ _updatedAt: '2026-04-01', description: text })],
    ['a description the graph never imported, changed in Sanity', person(), sanityDoc({ description: text })],
  ])('%s', (_label, g, s) => {
    const { checked, differ } = check(g, s)
    expect(checked).toBe(1)
    expect(differ).toEqual([])
  })
})
