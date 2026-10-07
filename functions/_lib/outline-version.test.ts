import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only the module that talks to Neo4j is replaced, by a small model of an outline and what it produced.
vi.mock('./neo4j.ts', () => ({ runCypher: vi.fn(), runCypherTx: vi.fn() }))

const { runCypher } = await import('./neo4j.ts')
const { entityRef, outlineContentSha, outlineState, readOutlineVersion, readProduced } = await import('./outline-version.ts')
const { archiveOutlineStatement } = await import('../api/admin/proposals/_apply.ts')

const env = {} as Parameters<typeof readOutlineVersion>[0]
const block = (text: string, key = 'a') => ({ _type: 'block', _key: key, children: [{ _type: 'span', _key: 's', text }] })
const text = (...texts: string[]) => JSON.stringify(texts.map((t, i) => block(t, `k${i}`)))

describe('outlineContentSha: the version of an outline is a hash of its text', () => {
  const A = [{ order: 1, content: text('Første avsnitt.') }]

  it('is the same however the JSON is written and in whatever order the rows come', async () => {
    const sha = await outlineContentSha(A)
    expect(await outlineContentSha([{ order: 1, content: JSON.stringify(JSON.parse(A[0].content), null, 2) }])).toBe(sha)
    const two = [{ order: 2, content: text('To.') }, { order: 1, content: text('Én.') }]
    expect(await outlineContentSha(two)).toBe(await outlineContentSha([...two].reverse()))
  })

  it('changes with the text, with the order of the descriptions, and when a description is added', async () => {
    const sha = await outlineContentSha(A)
    expect(await outlineContentSha([{ order: 1, content: text('Et annet avsnitt.') }])).not.toBe(sha)
    expect(await outlineContentSha([{ order: 2, content: A[0].content }])).not.toBe(sha)
    expect(await outlineContentSha([...A, { order: 2, content: text('Mer.') }])).not.toBe(sha)
  })

  it('ignores a description with no content, and has a hash for an outline with no text', async () => {
    expect(await outlineContentSha([...A, { order: 2, content: null }])).toBe(await outlineContentSha(A))
    expect(await outlineContentSha([])).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does not depend on anything of Sanity', async () => {
    expect(await outlineContentSha(A)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('outlineState', () => {
  it('is new until a bundle made from it has been fully accepted', () => {
    expect(outlineState({ contentSha: 'a', absorbedSha: null })).toBe('new')
  })
  it('is absorbed while the text is what the accepted bundle was made from, and stale when it has changed', () => {
    expect(outlineState({ contentSha: 'a', absorbedSha: 'a' })).toBe('absorbed')
    expect(outlineState({ contentSha: 'b', absorbedSha: 'a' })).toBe('stale')
  })
  it('is bundled while a bundle made from it is open, whatever else is true', () => {
    expect(outlineState({ contentSha: 'a', absorbedSha: null, openBundles: 1 })).toBe('bundled')
    expect(outlineState({ contentSha: 'b', absorbedSha: 'a', openBundles: 2 })).toBe('bundled')
    expect(outlineState({ contentSha: 'a', absorbedSha: 'a', openBundles: 0 })).toBe('absorbed')
  })
})

describe('entityRef', () => {
  it('names an entity by its kind label and key, and nothing that is not an entity', () => {
    expect(entityRef(['Operation'], 'linge-pulje-4')).toBe('Operation:linge-pulje-4')
    expect(entityRef(['Thing', 'Source'], 'granlund-rapport-1942')).toBe('Source:granlund-rapport-1942')
    expect(entityRef(['Description'], 'desc:1')).toBeNull()
    expect(entityRef(['Person'], undefined)).toBeNull()
  })
})

/** A model of the graph the queries ask about: one outline, its text, and the nodes and edges that carry its origin. */
interface Model {
  outline: { absorbedSha: string | null; absorbedBundle: string | null; archivedAt: string | null; descriptions: { order: number; content: string }[] }
  nodes:   { labels: string[]; key: string; sha: string; bundle: string }[]
  edges:   { type: string; fromLabels: string[]; fromKey: string; toLabels: string[]; toKey: string; sha: string; bundle: string }[]
}
const model: Model = { outline: { absorbedSha: null, absorbedBundle: null, archivedAt: null, descriptions: [] }, nodes: [], edges: [] }

beforeEach(() => {
  vi.mocked(runCypher).mockReset()
  vi.mocked(runCypher).mockImplementation((_env, statement) => {
    if (/MATCH \(o:Outline \{slug: \$slug\}\)\s+OPTIONAL MATCH/.test(statement)) {
      const o = model.outline
      return Promise.resolve([{ absorbedSha: o.absorbedSha, absorbedBundle: o.absorbedBundle, archivedAt: o.archivedAt, descriptions: o.descriptions }] as never)
    }
    if (/MATCH \(n\) WHERE n\.originOutline/.test(statement)) return Promise.resolve(model.nodes as never)
    if (/MATCH \(a\)-\[r\]->\(b\) WHERE r\.originOutline/.test(statement)) return Promise.resolve(model.edges as never)
    return Promise.resolve([] as never)
  })
})

/** What `archiveOutlineStatement` does to the model: the same four properties. */
function archive(a: Parameters<typeof archiveOutlineStatement>[0]) {
  const p = archiveOutlineStatement(a).parameters
  model.outline.archivedAt = p.at as string
  model.outline.absorbedSha = p.sha as string | null
  model.outline.absorbedBundle = p.bundle as string
}

describe('an outline that is absorbed, then changed', () => {
  it('is new, then absorbed once its bundle is accepted, then stale when the text changes, and what it produced is marked older', async () => {
    model.outline = { absorbedSha: null, absorbedBundle: null, archivedAt: null, descriptions: [{ order: 1, content: text('Operasjonen fant sted i mars.') }] }
    model.nodes = []; model.edges = []

    const first = (await readOutlineVersion(env, 'linge-pulje-4'))!
    expect(first.state).toBe('new')

    // The bundle is made from this version, and is accepted: it creates an operation and an edge, and archives the outline.
    model.nodes = [{ labels: ['Operation'], key: 'linge-pulje-4', sha: first.contentSha, bundle: 'bundle:linge-pulje-4:t1' }]
    model.edges = [{ type: 'PART_OF', fromLabels: ['Operation'], fromKey: 'linge-pulje-4', toLabels: ['Unit'], toKey: 'linge', sha: first.contentSha, bundle: 'bundle:linge-pulje-4:t1' }]
    archive({ slug: 'linge-pulje-4', at: '2026-10-07T12:00:00Z', reason: 'absorbed', sha: first.contentSha, bundleId: 'bundle:linge-pulje-4:t1' })

    const absorbed = (await readOutlineVersion(env, 'linge-pulje-4'))!
    expect(absorbed).toMatchObject({ state: 'absorbed', absorbedSha: first.contentSha, absorbedBundle: 'bundle:linge-pulje-4:t1', contentSha: first.contentSha })
    expect((await readProduced(env, 'linge-pulje-4', absorbed.contentSha)).entities.map(e => e.olderVersion)).toEqual([false])

    // The text changes: the outline is stale, and what it produced is from an older version.
    model.outline.descriptions = [{ order: 1, content: text('Operasjonen fant sted i april.') }]
    const stale = (await readOutlineVersion(env, 'linge-pulje-4'))!
    expect(stale.state).toBe('stale')
    expect(stale.contentSha).not.toBe(first.contentSha)
    expect(stale.absorbedSha).toBe(first.contentSha)                      // what the accepted bundle was made from is kept

    const produced = await readProduced(env, 'linge-pulje-4', stale.contentSha)
    expect(produced.entities).toEqual([{ ref: 'Operation:linge-pulje-4', originBundle: 'bundle:linge-pulje-4:t1', originSha: first.contentSha, olderVersion: true }])
    expect(produced.edges).toEqual([{ type: 'PART_OF', from: 'Operation:linge-pulje-4', to: 'Unit:linge', originBundle: 'bundle:linge-pulje-4:t1', originSha: first.contentSha, olderVersion: true }])
  })

  it('is null for an outline that is not there', async () => {
    vi.mocked(runCypher).mockResolvedValueOnce([] as never)
    expect(await readOutlineVersion(env, 'nope')).toBeNull()
  })
})

describe('readProduced', () => {
  it('lists entities and edges in a fixed order, and leaves out nodes that are no entity', async () => {
    model.nodes = [
      { labels: ['Unit'], key: 'b-unit', sha: 'x', bundle: 'b1' },
      { labels: ['Description'], key: 'desc:1', sha: 'x', bundle: 'b1' },
      { labels: ['Article'], key: 'a-article', sha: 'y', bundle: 'b2' },
    ]
    model.edges = []
    const p = await readProduced(env, 'o', 'y')
    expect(p.entities.map(e => [e.ref, e.olderVersion])).toEqual([['Article:a-article', false], ['Unit:b-unit', true]])
  })
})

describe('archiveOutlineStatement', () => {
  it('records the archive and what was absorbed: the hash the bundle was made from, and the bundle', () => {
    const s = archiveOutlineStatement({ slug: 'linge-pulje-4', at: 'T', reason: 'r', sha: 'abc', bundleId: 'bundle:x:t' })
    expect(s.statement).toContain('o.absorbedSha = $sha')
    expect(s.statement).toContain('o.absorbedBundle = $bundle')
    expect(s.parameters).toEqual({ slug: 'linge-pulje-4', at: 'T', reason: 'r', sha: 'abc', bundle: 'bundle:x:t' })
  })
  it('records no hash when the bundle had none, rather than a made-up one', () => {
    expect(archiveOutlineStatement({ slug: 's', at: 'T', reason: 'r', bundleId: 'b' }).parameters.sha).toBeNull()
  })
})
