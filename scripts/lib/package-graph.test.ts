import { describe, expect, it } from 'vitest'
import type { Session } from 'neo4j-driver'
import { edgeTarget, entityParts, findNode, parseRef } from './package-graph.ts'

describe('parseRef', () => {
  it('reads Kind:key for the kinds a package may hold', () => {
    expect(parseRef('Transport:mtb-683')).toEqual({ kind: 'Transport', key: 'mtb-683' })
    expect(parseRef(' Unit:kompani-linge ')).toEqual({ kind: 'Unit', key: 'kompani-linge' })
    expect(parseRef('Source:granlund-rapport-1942')).toEqual({ kind: 'Source', key: 'granlund-rapport-1942' })
  })
  it('refuses a kind that is not an entity, and what is not a reference', () => {
    expect(parseRef('Description:x')).toBeNull()
    expect(parseRef('mtb-683')).toBeNull()
    expect(parseRef('Transport:Has Space')).toBeNull()
  })
})

describe('edgeTarget', () => {
  it('names the entity an edge points at by its kind label and slug, and a Source by its id', () => {
    expect(edgeTarget(['Unit'], { slug: 'kompani-linge' })).toBe('Unit:kompani-linge')
    expect(edgeTarget(['Source'], { id: 'granlund-rapport-1942' })).toBe('Source:granlund-rapport-1942')
  })
  it('uses the first known kind when a node has several labels', () => {
    expect(edgeTarget(['Thing', 'Operation'], { slug: 'x' })).toBe('Operation:x')
  })
  it('is null for a node that is no entity, or has no key', () => {
    expect(edgeTarget(['Description'], { id: 'desc:1' })).toBeNull()
    expect(edgeTarget(['Person'], {})).toBeNull()
  })
})

describe('entityParts', () => {
  it('turns graph rows into a snapshot\'s parts, in order, and counts the edges it leaves out', () => {
    const parts = entityParts({
      props: { slug: 'mtb-683' },
      descriptions: [{ order: 2, content: '[]' }, { order: 1, content: '[]' }, { order: 'x', content: '[]' }, { order: 3, content: 5 }],
      edges: [
        { type: 'USED_BY', labels: ['Unit'], target: { slug: 'flotilla' }, props: { from: '1943' } },
        { type: 'CREW_OF', labels: ['Person'], target: { slug: 'erik' }, props: {} },
        { type: 'HAS_CARD', labels: ['Card'], target: { id: 'c1' }, props: {} },
      ],
    })
    expect(parts.descriptions.map(d => d.order)).toEqual([1, 2])
    expect(parts.edges).toEqual([
      { type: 'USED_BY', to: 'Unit:flotilla', props: { from: '1943' } },
      { type: 'CREW_OF', to: 'Person:erik' },
    ])
    expect(parts.skippedEdges).toBe(1)
  })
})

/** A session that answers by the first words of the query: the node an import made from a ref, and a node by key. */
function fakeSession(opts: { importedFrom?: Record<string, string>; nodes: Record<string, Record<string, unknown>> }): { session: Session; queries: string[] } {
  const queries: string[] = []
  const session = {
    run: (query: string, params: { ref?: string; key?: string }) => {
      queries.push(query.includes('importedFrom') ? `by ref ${params.ref}` : `by key ${params.key}`)
      if (query.includes('importedFrom')) {
        const key = opts.importedFrom?.[params.ref!]
        return Promise.resolve({ records: key ? [{ get: () => key }] : [] })
      }
      const props = opts.nodes[params.key!]
      return Promise.resolve({ records: props ? [{ get: (n: string) => ({ props, descriptions: [], edges: [] })[n] }] : [] })
    },
  } as unknown as Session
  return { session, queries }
}

describe('findNode', () => {
  const ref = 'https://archive.example/transport/mtb-683'

  it('finds the node an earlier import made from the same source ref: linked', async () => {
    const { session } = fakeSession({ importedFrom: { [ref]: 'mtb-683' }, nodes: { 'mtb-683': { regser: '683' } } })
    expect(await findNode(session, 'Transport', 'mtb-683', ref)).toEqual({ key: 'mtb-683', live: { props: { regser: '683' }, descriptions: [], edges: [] }, linked: true })
  })

  it('finds it under the key it has now when it was renamed here', async () => {
    const { session } = fakeSession({ importedFrom: { [ref]: 'mtb-683-renamed' }, nodes: { 'mtb-683-renamed': { regser: '683' } } })
    expect(await findNode(session, 'Transport', 'mtb-683', ref)).toMatchObject({ key: 'mtb-683-renamed', linked: true })
  })

  it('falls back to the same kind and key, and says it is not a link made by an import', async () => {
    const { session, queries } = fakeSession({ nodes: { 'mtb-683': { regser: '683' } } })
    expect(await findNode(session, 'Transport', 'mtb-683', ref)).toMatchObject({ key: 'mtb-683', linked: false })
    expect(queries).toEqual([`by ref ${ref}`, 'by key mtb-683'])
  })

  it('is null when neither is there', async () => {
    const { session } = fakeSession({ nodes: {} })
    expect(await findNode(session, 'Transport', 'mtb-683', ref)).toBeNull()
  })
})
