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
vi.mock('./useArticleData.ts', async () => {
  const { ref } = await import('vue')
  return {
    useArticleData: () => {
      const article       = ref<unknown>(null)
      const savedSections = ref<unknown[]>([])
      return {
        article, savedSections,
        loadArticle: (slug: string) => {
          loaded.push(slug)
          article.value = { slug, title: 'Code names', author: 'jan', topic: null }
          savedSections.value = [{ order: 1, content: blocks('Live.'), citations: [], sourcedFrom: null }]
          return Promise.resolve()
        },
        resetArticle: () => { article.value = null; savedSections.value = [] },
      }
    },
  }
})

import { useProposalArticleData } from './useProposalArticleData.ts'

const make = (...ops: BundleOp[]): EntityPayload => ({
  entityId: 'Article:code-names', ops,
  derivedFrom: { source: { site: 'https://a.example', path: '/article/code-names' } }, source: 's', generatedAt: 'now',
})

describe('useProposalArticleData', () => {
  beforeEach(() => { loaded.length = 0; payload = null })

  it('lays a create-entity over nothing: the preview shows the bundle, not Neo4j', async () => {
    payload = make({
      op: 'create-entity', kind: 'Article', slug: 'code-names',
      props: { title: 'Code names', author: 'jan', topic: 'Kodenavn' },
      descriptions: [{ order: 1, content: blocks('Ny.') }],
    })
    const d = useProposalArticleData('b1', 'Article:code-names')
    await d.loadArticle()
    expect(loaded).toEqual([])
    expect(d.article.value).toEqual({ slug: 'code-names', title: 'Code names', author: 'jan', topic: 'Kodenavn' })
    expect(d.savedSections.value.map(s => s.content)).toEqual([blocks('Ny.')])
    expect(d._proposal.value.error).toBeNull()
  })

  it('lays a set-description over the live article', async () => {
    payload = make({ op: 'set-description', order: 1, expectedSha: 'x', content: blocks('Endret.') })
    const d = useProposalArticleData('b1', 'Article:code-names')
    await d.loadArticle()
    expect(loaded).toEqual(['code-names'])
    expect(d.savedSections.value.map(s => s.content)).toEqual([blocks('Endret.')])
  })

  it('says so when the id is not an Article, or not in the bundle', async () => {
    payload = make({ op: 'create-entity', kind: 'Article', slug: 'code-names', props: {} })
    const wrong = useProposalArticleData('b1', 'Unit:code-names')
    await wrong.loadArticle()
    expect(wrong._proposal.value.error).toMatch(/not an Article id/)

    payload = null
    const missing = useProposalArticleData('b1', 'Article:code-names')
    await missing.loadArticle()
    expect(missing._proposal.value.error).toMatch(/not found in bundle/)
  })
})
