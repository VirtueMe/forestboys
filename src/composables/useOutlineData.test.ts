import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./useNeo4j.ts', () => ({ neo4jQuery: vi.fn() }))

import { neo4jQuery } from './useNeo4j.ts'
import { useOutlineData } from './useOutlineData.ts'

type Row = Record<string, unknown>

/** A pretend graph: it answers each query of the loader by what the query asks for, and keeps what was asked. */
function graph(opts: { links?: Row[]; images?: Row[] } = {}) {
  const asked: { cypher: string; params: unknown }[] = []
  vi.mocked(neo4jQuery).mockImplementation((cypher: string, params?: unknown) => {
    asked.push({ cypher, params })
    if (cypher.includes('RETURN o.slug AS slug')) return Promise.resolve([{ slug: 'olga', canonicalName: 'OLGA', sanityRev: null }])
    if (cypher.includes('REFERENCED_IN')) return Promise.resolve(opts.links ?? [])
    if (cypher.includes('HAS_IMAGE')) return Promise.resolve(opts.images ?? [])
    return Promise.resolve([])
  })
  return asked
}

const link = (id: string, over: Row = {}) => ({ id, title: `Lenke ${id}`, url: `https://example.org/${id}`, type: 'web', domain: 'example.org', nbBacked: false, ...over })

describe('useOutlineData: the gallery and the links of an outline (#321)', () => {
  beforeEach(() => { vi.mocked(neo4jQuery).mockReset() })

  it('loads the sources the outline is referenced in as its links, as they come', async () => {
    graph({ links: [link('a', { nbBacked: true, domain: 'nb.no' }), link('b')] })
    const { externalRefs, loadOutline } = useOutlineData()
    await loadOutline('olga')
    expect(externalRefs.value.map(r => r.id)).toEqual(['a', 'b'])
    expect(externalRefs.value[0]).toMatchObject({ title: 'Lenke a', url: 'https://example.org/a', nbBacked: true, domain: 'nb.no' })
  })

  it('loads the images as slides with their captions, in the order of the graph, and each image once', async () => {
    graph({ images: [
      { url: 'https://cdn.sanity.io/images/x/1.jpg', caption: 'Første' },
      { url: 'https://cdn.sanity.io/images/x/2.jpg', caption: null },
      { url: 'https://cdn.sanity.io/images/x/1.jpg', caption: 'Igjen' },
      { url: '', caption: 'Uten adresse' },
    ] })
    const { galleryImages, loadOutline } = useOutlineData()
    await loadOutline('olga')
    expect(galleryImages.value).toEqual([
      { url: 'https://cdn.sanity.io/images/x/1.jpg', caption: 'Første' },
      { url: 'https://cdn.sanity.io/images/x/2.jpg', caption: null },
    ])
  })

  it('asks for the links and the images of this outline, in the order the gallery has (`order` on the edge)', async () => {
    const asked = graph()
    await useOutlineData().loadOutline('olga')
    const links  = asked.find(a => a.cypher.includes('REFERENCED_IN'))!
    const images = asked.find(a => a.cypher.includes('HAS_IMAGE'))!
    expect(links.params).toEqual({ slug: 'olga' })
    expect(images.params).toEqual({ slug: 'olga' })
    expect(links.cypher).toContain('(:Outline {slug: $slug})')
    expect(images.cypher).toContain('ORDER BY coalesce(h.order')
  })

  it('has neither when the outline has none, so the page shows no empty section', async () => {
    graph()
    const { externalRefs, galleryImages, loadOutline } = useOutlineData()
    await loadOutline('olga')
    expect(externalRefs.value).toEqual([])
    expect(galleryImages.value).toEqual([])
  })

  it('forgets them when the page moves on, and has none for a new outline', async () => {
    graph({ links: [link('a')], images: [{ url: 'https://cdn.sanity.io/images/x/1.jpg', caption: null }] })
    const { externalRefs, galleryImages, loadOutline, resetOutline } = useOutlineData()
    await loadOutline('olga')
    expect(externalRefs.value).toHaveLength(1)
    resetOutline()
    expect(externalRefs.value).toEqual([])
    expect(galleryImages.value).toEqual([])
    await loadOutline('new')
    expect(externalRefs.value).toEqual([])
  })
})
