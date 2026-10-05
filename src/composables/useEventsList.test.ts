import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./useNeo4j.ts', () => ({ neo4jQuery: vi.fn() }))

import { neo4jQuery } from './useNeo4j.ts'
import { fetchEventDetailFromNeo4j } from './useEventsList.ts'

type Row = Record<string, unknown>

/** A pretend graph: it answers each query of the loader by what the query asks for. */
function graph(opts: { kind?: 'operation' | 'incident'; links?: Row[] }) {
  const asked: string[] = []
  vi.mocked(neo4jQuery).mockImplementation((cypher: string) => {
    asked.push(cypher)
    if (cypher.includes('AS kind')) return Promise.resolve([{ kind: opts.kind ?? 'operation', title: 'NRK Første sending fra BBC', date: '1940-04-09', organization: 'Norge', district: 'Norge' }])
    if (cypher.includes('REFERENCED_IN')) return Promise.resolve(opts.links ?? [])
    return Promise.resolve([])
  })
  return asked
}

describe('fetchEventDetailFromNeo4j: Nyttige lenker', () => {
  beforeEach(() => { vi.mocked(neo4jQuery).mockReset() })

  it('returns the sources the event is referenced in as links, in the shape EventPanel reads', async () => {
    graph({
      links: [
        { id: 'src:1', title: 'BBC Homeservice Artil 1940', url: 'https://genome.ch.bbc.co.uk/schedules/service_home_service/1940-04-09' },
        { id: 'src:2', title: 'Hartivg Kiran 9 april ', url: 'https://www.nb.no/items/47d82876b74ba5ff3aecc814f6a7912b' },
      ],
    })
    const detail = await fetchEventDetailFromNeo4j('nrk-1')
    expect(detail?.links).toEqual([
      { _key: 'src:1', title: 'BBC Homeservice Artil 1940', link: 'https://genome.ch.bbc.co.uk/schedules/service_home_service/1940-04-09' },
      { _key: 'src:2', title: 'Hartivg Kiran 9 april', link: 'https://www.nb.no/items/47d82876b74ba5ff3aecc814f6a7912b' },
    ])
  })

  it('has no links, not an empty list, when the event is referenced nowhere', async () => {
    graph({ links: [] })
    expect((await fetchEventDetailFromNeo4j('nrk-1'))?.links).toBeUndefined()
  })

  it('keeps a link that has no title, so the panel can show its address', async () => {
    graph({ links: [{ id: null, title: null, url: 'https://example.org/a' }, { id: 's', title: '   ', url: 'https://example.org/b' }] })
    const links = (await fetchEventDetailFromNeo4j('nrk-1'))?.links
    expect(links).toEqual([
      { _key: 'https://example.org/a', title: undefined, link: 'https://example.org/a' },
      { _key: 's', title: undefined, link: 'https://example.org/b' },
    ])
  })

  it('asks for the links of an incident under its own label', async () => {
    const asked = graph({ kind: 'incident', links: [] })
    await fetchEventDetailFromNeo4j('some-incident')
    const q = asked.find(c => c.includes('REFERENCED_IN'))!
    expect(q).toContain('`Incident`')
    expect(q).not.toContain('`Operation`')
  })
})
