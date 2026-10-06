import { describe, expect, it } from 'vitest'
import { baselineSha, calibrateEvents, classifyEvent, eventsToStamp, sha, stampsFor, verifyEventStamps, type GraphEvent } from './event-sync.ts'
import type { Doc } from './person-sync.ts'
import type { Lookups } from './event-rule.ts'
import { linkArchiveBlocks } from '../../src/utils/archiveRefs.ts'
import { stableJson } from './sanity-sha.ts'

const lookups = (): Lookups => ({
  Organization: new Map(), Unit: new Map(), Location: new Map(),
  Station: new Map(), Transport: new Map(), Person: new Map(),
})

const doc = (over: Record<string, unknown> = {}): Doc =>
  ({ _id: 'e1', _updatedAt: '2026-05-01', title: 'Landing', slug: { current: 'landing' }, date: '1944-01-01', ...over })

const graphEvent = (over: Partial<GraphEvent> = {}): GraphEvent => ({
  sanityId: 'e1', sanityUpdatedAt: '2026-04-01', label: 'Incident', slug: 'landing', name: 'Landing', date: '1944-01-01',
  organization: [], district: [], locationFrom: [], locationTo: [], stationFrom: [], stationTo: [],
  people: [], transport: [], images: [], links: [], description: null, stamps: {}, ...over,
})

const verdictOf = (v: { field: string; verdict: string }[], field: string) => v.find(x => x.field === field)?.verdict

describe('baselineSha', () => {
  const l = lookups()
  const f = { name: 'title', fromSanity: (d: Doc) => String(d.title), fromGraph: () => '' }

  it('prefers the stamp on the node', () => {
    const g = graphEvent({ stamps: { title_sha: 'stamped' } })
    expect(baselineSha(g, f, doc({ _updatedAt: '2026-04-01' }), l)).toBe('stamped')
  })

  it('uses the baseline file only when it is the version the graph took in', () => {
    const g = graphEvent({ sanityUpdatedAt: '2026-04-01' })
    expect(baselineSha(g, f, doc({ _updatedAt: '2026-04-01', title: 'Old' }), l)).toBe(sha('Old'))
    expect(baselineSha(g, f, doc({ _updatedAt: '2026-04-02', title: 'Old' }), l)).toBeUndefined()
  })

  it('has no baseline with no stamp and no file', () => {
    expect(baselineSha(graphEvent(), f, undefined, l)).toBeUndefined()
  })
})

describe('classifyEvent without a baseline file (CI)', () => {
  const l = lookups()

  it('sends a changed field with no stamp to review, never to an automatic apply', () => {
    const v = classifyEvent(graphEvent(), doc({ title: 'Landing at dawn' }), undefined, l)
    expect(verdictOf(v, 'title')).toBe('review')
  })

  it('ignores a field whose graph value already equals Sanity', () => {
    expect(classifyEvent(graphEvent(), doc(), undefined, l)).toEqual([])
  })

  it('works from the stamps alone: clean when the graph still holds the stamped value', () => {
    const g = graphEvent({ stamps: stampsFor(doc(), l) })
    const v = classifyEvent(g, doc({ title: 'Landing at dawn' }), undefined, l)
    expect(verdictOf(v, 'title')).toBe('clean')
  })

  it('is a conflict when the graph was edited since the stamp', () => {
    const g = graphEvent({ name: 'Landing (edited)', stamps: stampsFor(doc(), l) })
    const v = classifyEvent(g, doc({ title: 'Landing at dawn' }), undefined, l)
    expect(verdictOf(v, 'title')).toBe('conflict')
  })

  it('is already when the graph holds the new value', () => {
    const g = graphEvent({ name: 'Landing at dawn', stamps: stampsFor(doc(), l) })
    const v = classifyEvent(g, doc({ title: 'Landing at dawn' }), undefined, l)
    expect(verdictOf(v, 'title')).toBe('already')
  })
})

describe('classifyEvent with archive references in the description (#106)', () => {
  const l = lookups()
  const raw = [{ _key: 'b1', _type: 'block', markDefs: [], children: [{ _key: 's1', _type: 'span', marks: [], text: 'Se AIR-27-1068-2 p13' }] }]
  const linked = linkArchiveBlocks(raw)
  const graphWith = (description: unknown, stamps: Record<string, string> = {}) =>
    graphEvent({ description: JSON.stringify(description), stamps })
  const oldStamp = { description_sha: sha(stableJson(raw)) }   // stamped before the links existed

  it('takes the links in on the first run as an ordinary change: the graph still holds the stamped text', () => {
    const v = classifyEvent(graphWith(raw, oldStamp), doc({ description: raw }), undefined, l)
    expect(verdictOf(v, 'description')).toBe('clean')
  })

  it('leaves a graph that holds the links, stamped from Sanity, alone', () => {
    const stamps = stampsFor(doc({ description: raw }), l)
    expect(classifyEvent(graphWith(linked, stamps), doc({ description: raw }), undefined, l)).toEqual([])
  })

  it('applies a later Sanity edit cleanly: the links are not a graph edit', () => {
    const stamps = stampsFor(doc({ description: raw }), l)
    const edited = [{ ...raw[0], children: [{ ...raw[0].children[0], text: 'Se AIR-27-1068-2 p14' }] }]
    const v = classifyEvent(graphWith(linked, stamps), doc({ description: edited }), undefined, l)
    expect(verdictOf(v, 'description')).toBe('clean')
  })

  it('rewrites a description edited in the graph from Sanity instead of calling it a conflict (#119)', () => {
    const editedInGraph = [{ ...raw[0], children: [{ ...raw[0].children[0], text: 'Rettet i grafen AIR-27-1068-2' }] }]
    const v = classifyEvent(graphWith(editedInGraph, oldStamp), doc({ description: raw }), undefined, l)
    expect(verdictOf(v, 'description')).toBe('reset')
  })

  it('still calls a description edited in the graph a conflict when nothing is reset from Sanity', () => {
    const editedInGraph = [{ ...raw[0], children: [{ ...raw[0].children[0], text: 'Rettet i grafen AIR-27-1068-2' }] }]
    const v = classifyEvent(graphWith(editedInGraph, oldStamp), doc({ description: raw }), undefined, l, new Set())
    expect(verdictOf(v, 'description')).toBe('conflict')
  })

  it('leaves a description with no reference as it was: its old stamp still holds', () => {
    const plain = [{ _key: 'b1', _type: 'block', markDefs: [], children: [{ _key: 's1', _type: 'span', marks: [], text: 'Ingenting her' }] }]
    const stamp = { description_sha: sha(stableJson(plain)) }
    expect(classifyEvent(graphWith(plain, stamp), doc({ description: plain }), undefined, l)).toEqual([])
  })
})

describe('eventsToStamp / verifyEventStamps', () => {
  const l = lookups()
  const baseDoc = doc({ _updatedAt: '2026-04-01' })
  const base = new Map([['e1', baseDoc]])
  const check = (g: GraphEvent, s: Doc) => verifyEventStamps([g], new Map([['e1', s]]), base, l)

  it('picks the unstamped events whose baseline is the version the graph took in', () => {
    const graph = new Map<string, GraphEvent>([
      ['e1', graphEvent()],
      ['e2', graphEvent({ sanityId: 'e2' })],
      ['e3', graphEvent({ sanityId: 'e3', stamps: { title_sha: 'x' } })],
    ])
    const b = new Map([['e1', baseDoc], ['e3', { ...baseDoc, _id: 'e3' }]])
    expect(eventsToStamp(graph, b).map(g => g.sanityId)).toEqual(['e1'])
  })

  it.each([
    ['nothing changed in Sanity', graphEvent(), doc({ _updatedAt: '2026-04-01' })],
    ['Sanity changed, the graph still holds the baseline', graphEvent(), doc({ title: 'Landing at dawn' })],
    ['Sanity changed, the graph was edited', graphEvent({ name: 'Landing (edited)' }), doc({ title: 'Landing at dawn' })],
    ['Sanity changed, the graph already has the new value', graphEvent({ name: 'Landing at dawn' }), doc({ title: 'Landing at dawn' })],
    ['several fields changed at once', graphEvent(), doc({ title: 'Other', date: '1944-02-02' })],
  ])('%s', (_label, g, s) => {
    const { checked, differ } = check(g, s)
    expect(checked).toBe(1)
    expect(differ).toEqual([])
  })
})

describe('a description edited in the graph while Sanity is unchanged (#119)', () => {
  const l = lookups()
  const text = (t: string) => [{ _key: 'b1', _type: 'block', markDefs: [], children: [{ _key: 's1', _type: 'span', marks: [], text: t }] }]
  const sanityDoc = doc({ description: text('Original') })
  const stamps = stampsFor(sanityDoc, l)
  const edited = graphEvent({ description: JSON.stringify(text('Test i grafen')), stamps })
  const clean = graphEvent({ description: JSON.stringify(text('Original')), stamps })
  const calibration = (g: GraphEvent, reset?: ReadonlySet<string>) =>
    calibrateEvents(new Map([['e1', g]]), new Map([['e1', sanityDoc]]), new Map(), l, reset)

  it('is a reset: Sanity has not changed, the graph differs', () => {
    expect(verdictOf(classifyEvent(edited, sanityDoc, undefined, l), 'description')).toBe('reset')
  })

  it('is not a reset when the graph holds Sanity\'s text', () => {
    expect(classifyEvent(clean, sanityDoc, undefined, l)).toEqual([])
  })

  it('is a reset with no stamp and no baseline too: Sanity is the master', () => {
    const v = classifyEvent({ ...edited, stamps: {} }, sanityDoc, undefined, l)
    expect(verdictOf(v, 'description')).toBe('reset')
  })

  it('does not fail calibration', () => {
    const c = calibration(edited)
    expect(c.description).toBeUndefined()
    expect(Object.values(calibration(clean)).every(x => x.agree === x.total)).toBe(true)
  })

  it('fails calibration when nothing is reset from Sanity (the cutover)', () => {
    const c = calibration(edited, new Set())
    expect(c.description.agree).toBe(0)
    expect(c.description.total).toBe(1)
  })

  it('leaves other fields alone: an edited title is still a conflict, not a reset', () => {
    const g = graphEvent({ name: 'Landing (edited)', stamps })
    const v = classifyEvent(g, doc({ title: 'Landing at dawn', description: text('Original') }), undefined, l)
    expect(verdictOf(v, 'title')).toBe('conflict')
    expect(calibration(graphEvent({ name: 'Landing (edited)', stamps })).title.agree).toBe(0)
  })
})
