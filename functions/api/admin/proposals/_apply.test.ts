import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stableSha } from '~/_lib/stable-sha.ts'

// Only the module that talks to Neo4j is replaced: what the apply code asks of the graph is what is checked.
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn(), runCypherTx: vi.fn() }))
vi.mock('~/_lib/link-guard.ts', () => ({ judgeStored: vi.fn(() => Promise.resolve({ blocked: [] })), storedContents: vi.fn(() => Promise.resolve([])) }))

const { runCypher, runCypherTx } = await import('~/_lib/neo4j.ts')
const { applyEntityOps, checkDescriptionDrift, checkOpLinks } = await import('./_apply.ts')
const { judgeStored } = await import('~/_lib/link-guard.ts')

type Row = Record<string, unknown>
const cypher = vi.mocked(runCypher)
const tx     = vi.mocked(runCypherTx)
const env    = {} as Parameters<typeof applyEntityOps>[0]

const OLD = '[{"_type":"block","_key":"old","children":[]}]'
const NEW = '[{"_type":"block","_key":"new","children":[]}]'
const AT  = '2026-10-07T12:00:00.000Z'

/** The graph's answers, by what the query is about; every call is kept in `cypher.mock.calls`. */
function graph(rows: { descriptions?: Row[] }) {
  cypher.mockImplementation((_env, statement) => {
    if (/HAS_CONTENT\]->\(d:Description/.test(statement)) return Promise.resolve((rows.descriptions ?? []) as never)
    return Promise.resolve([] as never)
  })
}
const payload = (entityId: string, ops: unknown[]) => ({ entityId, ops, derivedFrom: { source: { site: 'https://a.example', path: '/x' } }, source: 's', generatedAt: AT }) as Parameters<typeof applyEntityOps>[2]
const statements = () => cypher.mock.calls.map(c => String(c[1]))
const writes = () => cypher.mock.calls.filter(c => /SET d\.content|CREATE \(e\)-\[:HAS_CONTENT/.test(String(c[1])))

beforeEach(() => { cypher.mockReset(); tx.mockReset(); vi.mocked(judgeStored).mockClear() })

describe('set-description: applying it', () => {
  const op = { op: 'set-description', order: 1, expectedSha: 'x', content: NEW }

  it('replaces the content and keeps what was there: the whole text, its sha, when, by which bundle, and that it is a description', async () => {
    graph({ descriptions: [{ descId: 'desc:Transport:mtb-683:1', content: OLD }] })
    const summary = await applyEntityOps(env, 'Transport:mtb-683', payload('Transport:mtb-683', [op]), 'bundle:package-a-example:t', AT)
    const [, , params] = writes()[0]
    expect(String(writes()[0][1])).toContain('d.previousKind   = \'description\'')
    expect(params).toEqual({
      descId: 'desc:Transport:mtb-683:1', content: NEW, previousValue: OLD,
      previousSha: await stableSha(JSON.parse(OLD)), previousAt: AT, previousSource: 'proposal:bundle:package-a-example:t',
    })
    expect(summary.appliedOps).toContain('description 1 on Transport:mtb-683')
  })

  it('creates the description when there is none, with the id a created entity gets', async () => {
    graph({ descriptions: [] })
    await applyEntityOps(env, 'Transport:mtb-683', payload('Transport:mtb-683', [{ ...op, expectedSha: '' }]), 'b', AT)
    expect(writes()).toHaveLength(1)
    expect(writes()[0][2]).toEqual({ slug: 'mtb-683', id: 'desc:Transport:mtb-683:1', order: 1, content: NEW })
    expect(String(writes()[0][1])).toContain('CREATE (e)-[:HAS_CONTENT]->(:Description')
  })

  it('looks for the description of that order only', async () => {
    graph({ descriptions: [] })
    await applyEntityOps(env, 'Transport:mtb-683', payload('Transport:mtb-683', [{ ...op, order: 3 }]), 'b', AT)
    expect(cypher.mock.calls[0][2]).toEqual({ slug: 'mtb-683', order: 3 })
    expect(statements()[0]).toContain('Description {order: $order}')
  })
})

describe('modify-block says what its previousValue is', () => {
  it('previousKind «block»: the one block it replaced, not the whole text', async () => {
    graph({ descriptions: [{ descId: 'd1', content: '[{"_type":"block","_key":"k1","children":[]}]' }] })
    await applyEntityOps(env, 'Person:erik', payload('Person:erik', [{ op: 'modify-block', blockPath: 'section.biography.block.k1', expectedSha: '', newValue: { _type: 'block', _key: 'k1', children: [] } }]), 'b', AT)
    expect(statements().find(s => s.includes('SET d.content'))).toContain("d.previousKind   = 'block'")
  })
})

describe('checkDescriptionDrift', () => {
  const op = (expectedSha: string) => [{ op: 'set-description', order: 1, expectedSha, content: NEW }] as Parameters<typeof checkDescriptionDrift>[2]

  it('finds none when the live description has the sha the proposal expected, however its JSON is written', async () => {
    const sha = await stableSha(JSON.parse(OLD))
    graph({ descriptions: [{ order: 1, content: JSON.stringify(JSON.parse(OLD), null, 2) }] })
    expect(await checkDescriptionDrift(env, 'Transport:mtb-683', op(sha))).toEqual([])
  })

  it('reports a description that changed since the proposal was made, as a drifted property', async () => {
    graph({ descriptions: [{ order: 1, content: NEW }] })
    const drift = await checkDescriptionDrift(env, 'Transport:mtb-683', op(await stableSha(JSON.parse(OLD))))
    expect(drift).toEqual([{ prop: 'description 1', expected: await stableSha(JSON.parse(OLD)), actual: await stableSha(JSON.parse(NEW)) }])
  })

  it('expects no description when the proposal says there is none, and finds drift if one has appeared', async () => {
    graph({ descriptions: [] })
    expect(await checkDescriptionDrift(env, 'Transport:mtb-683', op(''))).toEqual([])
    graph({ descriptions: [{ order: 1, content: OLD }] })
    expect(await checkDescriptionDrift(env, 'Transport:mtb-683', op(''))).toHaveLength(1)
    graph({ descriptions: [] })
    expect(await checkDescriptionDrift(env, 'Transport:mtb-683', op('abc'))).toEqual([{ prop: 'description 1', expected: 'abc', actual: '' }])
  })

  it('does not ask the graph when there is no such op', async () => {
    expect(await checkDescriptionDrift(env, 'Transport:mtb-683', [{ op: 'delete-entity' }])).toEqual([])
    expect(cypher).not.toHaveBeenCalled()
  })
})

describe('the link guard sees what set-description writes', () => {
  it('judges its content like any other text written', async () => {
    await checkOpLinks(env, 'Transport:mtb-683', [{ op: 'set-description', order: 1, expectedSha: '', content: NEW }])
    expect(vi.mocked(judgeStored).mock.calls[0][2]).toEqual([NEW])
  })
})

describe('the kinds keyed by id (a Source) and by slug (the rest)', () => {
  const created = (statementsOf: ReturnType<typeof tx.mock.calls.slice>) => statementsOf[0][1] as { statement: string; parameters?: Record<string, unknown> }[]

  it('creates an Article by slug, like every kind that was there', async () => {
    await applyEntityOps(env, 'Article:code-names', payload('Article:code-names', [{ op: 'create-entity', kind: 'Article', slug: 'code-names', props: { title: 'Code names' } }]), 'b', AT)
    const [create] = created(tx.mock.calls)
    expect(create.statement).toBe('CREATE (n:`Article`) SET n = $props, n.slug = $slug')
    expect(create.parameters).toEqual({ props: { title: 'Code names', slug: 'code-names' }, slug: 'code-names' })
  })

  it('creates a Source by id, with no slug', async () => {
    await applyEntityOps(env, 'Source:granlund-rapport-1942', payload('Source:granlund-rapport-1942', [{ op: 'create-entity', kind: 'Source', slug: 'granlund-rapport-1942', props: { title: 'Granlund' }, edges: [{ type: 'REFERENCED_IN', to: 'Person:erik' }] }]), 'b', AT)
    const [create, edge] = created(tx.mock.calls)
    expect(create.statement).toBe('CREATE (n:`Source`) SET n = $props, n.id = $slug')
    expect(create.parameters).toEqual({ props: { title: 'Granlund', id: 'granlund-rapport-1942' }, slug: 'granlund-rapport-1942' })
    expect(edge.statement).toContain('(a:`Source` {id: $fromSlug})')
  })

  it('matches a Source by id in set-props and delete, and every other kind by slug as before', async () => {
    await applyEntityOps(env, 'Source:granlund-rapport-1942', payload('Source:granlund-rapport-1942', [
      { op: 'set-props', props: { title: { from: 'a', to: 'b' } } }, { op: 'delete-entity' },
    ]), 'b', AT)
    const sts = created(tx.mock.calls).map(s => s.statement)
    expect(sts).toEqual(['MATCH (n:`Source` {id: $slug}) SET n += $set', 'MATCH (n:`Source` {id: $slug}) DETACH DELETE n'])
    tx.mockReset()
    await applyEntityOps(env, 'Transport:mtb-683', payload('Transport:mtb-683', [{ op: 'set-props', props: { regser: { from: 'a', to: 'b' } } }]), 'b', AT)
    expect(created(tx.mock.calls)[0].statement).toBe('MATCH (n:`Transport` {slug: $slug}) SET n += $set')
  })
})
