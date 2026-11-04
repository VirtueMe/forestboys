import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/composables/useAuth.ts', () => ({ authFetch: vi.fn() }))
vi.mock('@/composables/useNeo4j.ts', () => ({ neo4jQuery: vi.fn() }))

const { authFetch } = await import('@/composables/useAuth.ts')
const { neo4jQuery } = await import('@/composables/useNeo4j.ts')
const { OutlineMentionsStrategy } = await import('./strategies.ts')

const entry = (slug: string, name = slug) => ({
  targetSlug: slug, targetName: name, startDate: null, endDate: null, sections: [], hasDescription: false,
})

beforeEach(() => { vi.clearAllMocks() })

describe('OutlineMentionsStrategy (#389)', () => {
  it('reads the mentions as plain entries: no dates, no note', async () => {
    vi.mocked(neo4jQuery).mockResolvedValue([{ targetSlug: 'ola', targetName: 'Ola Nordmann' }])
    expect(await OutlineMentionsStrategy.fetchEntries('linge-medlemmer')).toEqual([entry('ola', 'Ola Nordmann')])
    expect(vi.mocked(neo4jQuery).mock.calls[0][1]).toEqual({ slug: 'linge-medlemmer' })
  })

  it('saves the slugs, in list order, to the outline\'s people endpoint', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response('{}', { status: 200 }))
    await OutlineMentionsStrategy.saveEntries('n-o-r-i-c-1', [entry('b'), entry('a')])
    const [url, init] = vi.mocked(authFetch).mock.calls[0]
    expect(url).toBe('/api/admin/outline/n-o-r-i-c-1/people')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({ people: ['b', 'a'] })
  })

  it('throws the server\'s message, so the editor shows it', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Ukjent person: ghost' }), { status: 400 }))
    await expect(OutlineMentionsStrategy.saveEntries('x', [entry('ghost')])).rejects.toThrow('Ukjent person: ghost')
  })

  it('falls back to the status when the body says nothing', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response('nope', { status: 502 }))
    await expect(OutlineMentionsStrategy.saveEntries('x', [])).rejects.toThrow('HTTP 502')
  })

  it('links a row to the person\'s page and has no note to save', async () => {
    expect(OutlineMentionsStrategy.targetRoute(entry('ola'))).toBe('/person/ola')
    await expect(OutlineMentionsStrategy.saveNote('x', 'ola', [])).resolves.toBeUndefined()
  })
})
