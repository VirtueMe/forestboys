import { describe, expect, it } from 'vitest'
import { baselineSha, classifyEvent, eventsToStamp, sha, stampsFor, verifyEventStamps, type GraphEvent } from './event-sync.ts'
import type { Doc } from './person-sync.ts'
import type { Lookups } from './event-rule.ts'

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
