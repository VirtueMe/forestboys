import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./useNeo4j.ts', () => ({ neo4jQuery: vi.fn() }))

import { neo4jQuery } from './useNeo4j.ts'
import { useEventData } from './useEventData.ts'

type Row = Record<string, unknown>

interface Graph {
  from?:     Row[]
  stationFrom?: Row[]
  gallery?:  Row[]
  links?:    Row[]
  sections?: Row[]
}

/** A pretend graph: each query of the loader is answered by what it asks for; anything else is empty. */
function graph(g: Graph | null) {
  vi.mocked(neo4jQuery).mockImplementation((cypher: string) => {
    if (!g) return Promise.resolve([])
    if (cypher.includes('AS kind'))      return Promise.resolve([{ kind: 'operation', name: 'Operasjon X', date: '1944-01-02' }])
    if (cypher.includes('HAS_CONTENT'))  return Promise.resolve(g.sections ?? [])
    if (cypher.includes('-[:FROM]->'))   return Promise.resolve(g.from ?? [])
    if (cypher.includes('FROM_STATION')) return Promise.resolve(g.stationFrom ?? [])
    if (cypher.includes('HAS_IMAGE'))    return Promise.resolve(g.gallery ?? [])
    if (cypher.includes('REFERENCED_IN')) return Promise.resolve(g.links ?? [])
    return Promise.resolve([])
  })
}

describe('useEventData: the page shows what the graph holds, and nothing else', () => {
  beforeEach(() => { vi.mocked(neo4jQuery).mockReset() })

  const full: Graph = {
    from:        [{ slug: 'oslo', title: 'Oslo', lat: 59.9, lng: 10.7 }],
    stationFrom: [{ slug: 'stn-1', title: 'Station 1' }],
    gallery:     [{ id: 'img-1', url: 'https://example.org/a.jpg', caption: 'A' }],
    links:       [{ id: 'src:1', title: 'Kilde', url: 'https://example.org/k' }],
    sections:    [{ order: 1, content: '[]' }],
  }

  it('reads place, base, gallery, links and description from the graph', async () => {
    graph(full)
    const d = useEventData()
    await d.loadEvent('op-x')
    expect(d.locationFrom.value?.slug).toBe('oslo')
    expect(d.stationFrom.value?.slug).toBe('stn-1')
    expect(d.gallery.value).toHaveLength(1)
    expect(d.links.value).toEqual([{ _key: 'src:1', title: 'Kilde', link: 'https://example.org/k' }])
    expect(d.savedSections.value).toHaveLength(1)
  })

  it('shows them as empty once an edit has removed the last of each, with no older copy coming back', async () => {
    graph(full)
    const d = useEventData()
    await d.loadEvent('op-x')

    graph({})
    await d.loadEvent('op-x')
    expect(d.locationFrom.value).toBeNull()
    expect(d.stationFrom.value).toBeNull()
    expect(d.gallery.value).toEqual([])
    expect(d.links.value).toEqual([])
    expect(d.savedSections.value).toEqual([])
    expect(d.personEntries.value).toEqual([])
  })

  it('has no event when the slug is not in the graph', async () => {
    graph(null)
    const d = useEventData()
    await d.loadEvent('missing')
    expect(d.event.value).toBeNull()
  })
})
