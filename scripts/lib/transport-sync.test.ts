import { describe, expect, it } from 'vitest'
import { sha, type Doc } from './person-sync.ts'
import {
  classifyTransport, needsTidy, newTransportProps, propsFor, stampsFor, type GraphTransport,
} from './transport-sync.ts'

const doc = (over: Record<string, unknown> = {}): Doc => ({
  _id: 't1', _updatedAt: '2026-05-11', name: 'Nona Rhea', type: 'Bomber', unit: '446 BS-1403 AAF', regser: ' 42-7612',
  slug: { current: 'nona-rhea' }, ...over,
})

const graph = (over: Partial<GraphTransport> = {}): GraphTransport => ({
  sanityId: 't1', sanityUpdatedAt: '2026-04-01', slug: 'nona-rhea', canonicalName: 'Nona Rhea', type: 'Bomber',
  regser: '42-7612', rawUnit: '446 BS-1403 AAF', unit: null, stamps: {}, ...over,
})

const verdictOf = (g: GraphTransport, s: Doc, field: string) => classifyTransport(g, s).find(v => v.field === field)?.verdict

describe('classifyTransport', () => {
  it('treats a value that differs only in whitespace as already taken in', () => {
    expect(verdictOf(graph(), doc(), 'regser')).toBe('already')
    expect(verdictOf(graph({ regser: ' 42-7612' }), doc(), 'regser')).toBe('already')
  })

  it('leaves a field alone while Sanity still holds what the stamp says', () => {
    const g = graph({ stamps: { name_sha: sha('Nona Rhea') } })
    expect(verdictOf(g, doc(), 'name')).toBeUndefined()
  })

  it('applies a Sanity change when the graph still holds the stamped value', () => {
    const g = graph({ rawUnit: '1403 AAF', stamps: { unit_sha: sha('1403 AAF') } })
    expect(verdictOf(g, doc(), 'unit')).toBe('clean')
  })

  it('reports a conflict when the graph value was edited since the stamp', () => {
    const g = graph({ canonicalName: 'Nona Rhea II', stamps: { name_sha: sha('Old name') } })
    expect(verdictOf(g, doc(), 'name')).toBe('conflict')
  })

  it('only moves the stamp when the graph already holds the new value', () => {
    const g = graph({ stamps: { name_sha: sha('Old name') } })
    expect(verdictOf(g, doc(), 'name')).toBe('already')
  })

  it('keeps a graph edit without a stamp when Sanity has not changed since the import', () => {
    const g = graph({ sanityUpdatedAt: '2026-05-11', rawUnit: '1403 AAF' })
    expect(verdictOf(g, doc(), 'unit')).toBe('kept')
  })

  it('sends a difference with no stamp and a newer Sanity to review', () => {
    expect(verdictOf(graph({ rawUnit: '1403 AAF' }), doc(), 'unit')).toBe('review')
  })

  it("reads the editor's unit before the import's rawUnit", () => {
    const g = graph({ unit: 'Edited unit', rawUnit: '1403 AAF', stamps: { unit_sha: sha('1403 AAF') } })
    expect(verdictOf(g, doc(), 'unit')).toBe('conflict')
  })

  it('treats empty on both sides as the same value', () => {
    expect(verdictOf(graph({ type: null }), doc({ type: undefined }), 'type')).toBe('already')
  })
})

describe('needsTidy', () => {
  it('is true only for a raw value with stray whitespace', () => {
    expect(needsTidy(graph({ regser: ' 42-7612' }), 'regser')).toBe(true)
    expect(needsTidy(graph(), 'regser')).toBe(false)
    expect(needsTidy(graph({ type: null }), 'type')).toBe(false)
  })
})

describe('stampsFor / propsFor', () => {
  it('stamps the hash of the tidied value', () => {
    expect(stampsFor(doc()).regser_sha).toBe(sha('42-7612'))
  })

  it("writes the import's claim properties, tidied", () => {
    expect(propsFor(doc(), 'regser')).toEqual({
      regser: '42-7612', regser_state: 'candidate', regser_sourceRef: 'sanity-migration:transport:t1:regser',
    })
    expect(propsFor(doc(), 'unit').rawUnit).toBe('446 BS-1403 AAF')
  })

  it('removes a property when Sanity has no value', () => {
    expect(propsFor(doc({ type: '  ' }), 'type')).toEqual({ type: null, type_state: null, type_sourceRef: null })
  })
})

describe('newTransportProps', () => {
  it('builds a node the way the import does, tidied and stamped', () => {
    const p = newTransportProps(doc({ name: 'Ford  Liberator\tB-24H', reserve: ' R ' }))
    expect(p).toMatchObject({
      slug: 'nona-rhea', sanityId: 't1', canonicalName: 'Ford Liberator B-24H', regser: '42-7612',
      rawUnit: '446 BS-1403 AAF', reserve: 'R', name_sha: sha('Ford Liberator B-24H'),
    })
  })
})
