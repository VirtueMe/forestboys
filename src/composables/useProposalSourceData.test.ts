import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BundleOp, EntityPayload } from './useProposalBundle.ts'

const blocks = (text: string) => JSON.stringify([{ _type: 'block', _key: 'k1', children: [{ _type: 'span', _key: 's', text }] }])

let payload: EntityPayload | null = null
vi.mock('./useProposalBundle.ts', () => ({
  useProposalBundle: () => ({
    load: () => Promise.resolve(),
    getEntityRef: (id: string) => (payload ? { entityId: id, status: 'pending', opSummary: [] } : null),
    getEntityPayload: () => payload,
  }),
}))

const loaded: string[] = []
vi.mock('./useSourceData.ts', async () => {
  const { ref } = await import('vue')
  return {
    useSourceData: () => {
      const source        = ref<unknown>(null)
      const savedSections = ref<unknown[]>([])
      return {
        source, savedSections,
        loadSource: (slug: string) => {
          loaded.push(slug)
          source.value = { id: slug, title: 'Granlund', type: 'report', url: null, authorFreeText: null, publishedDate: null }
          savedSections.value = [{ order: 1, content: blocks('Live.'), citations: [], sourcedFrom: null }]
          return Promise.resolve()
        },
        resetSource: () => { source.value = null; savedSections.value = [] },
      }
    },
  }
})

import { useProposalSourceData } from './useProposalSourceData.ts'

const make = (...ops: BundleOp[]): EntityPayload => ({
  entityId: 'Source:granlund-rapport-1942', ops,
  derivedFrom: { source: { site: 'https://a.example', path: '/source/granlund-rapport-1942' } }, source: 's', generatedAt: 'now',
})

describe('useProposalSourceData', () => {
  beforeEach(() => { loaded.length = 0; payload = null })

  it('lays a create-entity over nothing: the preview shows the bundle, not Neo4j', async () => {
    payload = make({
      op: 'create-entity', kind: 'Source', slug: 'granlund-rapport-1942',
      props: { title: 'Granlund', type: 'report', authorFreeText: 'Granlund', publishedDate: '1942' },
      descriptions: [{ order: 1, content: blocks('Ny.') }],
    })
    const d = useProposalSourceData('b1', 'Source:granlund-rapport-1942')
    await d.loadSource()
    expect(loaded).toEqual([])
    expect(d.source.value).toEqual({ id: 'granlund-rapport-1942', title: 'Granlund', type: 'report', url: null, authorFreeText: 'Granlund', publishedDate: '1942' })
    expect(d.savedSections.value.map(s => s.content)).toEqual([blocks('Ny.')])
    expect(d._proposal.value.error).toBeNull()
  })

  it('lays a set-description over the live source', async () => {
    payload = make({ op: 'set-description', order: 1, expectedSha: 'x', content: blocks('Endret.') })
    const d = useProposalSourceData('b1', 'Source:granlund-rapport-1942')
    await d.loadSource()
    expect(loaded).toEqual(['granlund-rapport-1942'])
    expect(d.savedSections.value.map(s => s.content)).toEqual([blocks('Endret.')])
  })

  it('says so when the id is not a Source, or not in the bundle', async () => {
    payload = make({ op: 'create-entity', kind: 'Source', slug: 'granlund-rapport-1942', props: {} })
    const wrong = useProposalSourceData('b1', 'Unit:granlund-rapport-1942')
    await wrong.loadSource()
    expect(wrong._proposal.value.error).toMatch(/not a Source id/)

    payload = null
    const missing = useProposalSourceData('b1', 'Source:granlund-rapport-1942')
    await missing.loadSource()
    expect(missing._proposal.value.error).toMatch(/not found in bundle/)
  })
})
