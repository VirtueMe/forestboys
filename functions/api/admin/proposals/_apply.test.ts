import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stableSha } from '~/_lib/stable-sha.ts'

// Only the module that talks to Neo4j is replaced: what the apply code asks of the graph is what is checked.
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn(), runCypherTx: vi.fn() }))
vi.mock('~/_lib/link-guard.ts', () => ({ judgeStored: vi.fn(() => Promise.resolve({ blocked: [] })), storedContents: vi.fn(() => Promise.resolve([])) }))

const { runCypher, runCypherTx } = await import('~/_lib/neo4j.ts')
const { applyEntityOps, checkDescriptionDrift, checkDrift, checkEntityExists, checkOpLinks, manifestSetStatus, setAside } = await import('./_apply.ts')
const { judgeStored } = await import('~/_lib/link-guard.ts')
const { recordOf, recordKey, toMetadata } = await import('../../../../src/utils/entityRecord.ts')

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
// A sync-style derivedFrom by default: it stamps nothing, so a test about something else sees the statements as they are.
const payload = (entityId: string, ops: unknown[]) => ({ entityId, ops, derivedFrom: { sanityId: 'abc', sanityRev: 'r1' }, source: 's', generatedAt: AT }) as Parameters<typeof applyEntityOps>[2]
const statements = () => cypher.mock.calls.map(c => String(c[1]))
const writes = () => cypher.mock.calls.filter(c => /SET d\.content|CREATE \(e\)-\[:HAS_CONTENT/.test(String(c[1])))

beforeEach(() => { cypher.mockReset(); cypher.mockResolvedValue([] as never); tx.mockReset(); vi.mocked(judgeStored).mockClear() })

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
    // A delete first removes what the entity owns (#187) and its old addresses (#96), then the node; all find a Source by id.
    expect(sts).toHaveLength(4)
    expect(sts[0]).toBe('MATCH (n:`Source` {id: $slug}) SET n += $set')
    expect(sts[1]).toMatch(/^MATCH \(n:`Source` \{id: \$slug\}\)\s+OPTIONAL MATCH \(n\)-\[:HAS_CONTENT\|/)
    expect(sts[2]).toBe('MATCH (a:SlugAlias)-[:ALIAS_OF]->(n:`Source` {id: $slug}) DETACH DELETE a')
    expect(sts[3]).toBe('MATCH (n:`Source` {id: $slug}) DETACH DELETE n')
    tx.mockReset()
    await applyEntityOps(env, 'Transport:mtb-683', payload('Transport:mtb-683', [{ op: 'set-props', props: { regser: { from: 'a', to: 'b' } } }]), 'b', AT)
    expect(created(tx.mock.calls)[0].statement).toBe('MATCH (n:`Transport` {slug: $slug}) SET n += $set')
  })
})

describe('what an accepted bundle writes on what it creates (#157)', () => {
  const OUTLINE = { outlineId: 'linge-pulje-4', outlineRev: 'abc123', sectionPath: 'overview' }
  const PACKAGE = { source: { site: 'https://a.example', path: '/transport/mtb-683' } }
  const SYNC    = { sanityId: 'abc', sanityRev: 'r1' }
  const BUNDLE  = 'bundle:linge-pulje-4:t'
  const withOrigin = (entityId: string, derivedFrom: unknown, ops: unknown[]) => ({ ...payload(entityId, ops), derivedFrom }) as Parameters<typeof applyEntityOps>[2]
  const create = { op: 'create-entity', kind: 'Operation', slug: 'linge-pulje-4', props: { canonicalName: 'Linge Pulje 4' }, edges: [{ type: 'PART_OF', to: 'Unit:linge', props: { role: 'x' } }] }
  const stmts = () => tx.mock.calls[0][1] as { statement: string; parameters?: Record<string, unknown> }[]

  it('stamps the node and its edges from an outline bundle: the outline, the hash, the bundle, the section', async () => {
    await applyEntityOps(env, 'Operation:linge-pulje-4', withOrigin('Operation:linge-pulje-4', OUTLINE, [create]), BUNDLE, AT)
    const stamp = { originOutline: 'linge-pulje-4', originSha: 'abc123', originBundle: BUNDLE, originSection: 'overview' }
    expect(stmts()[0].parameters!.props).toEqual({ canonicalName: 'Linge Pulje 4', ...stamp, slug: 'linge-pulje-4' })
    expect(stmts()[1].parameters!.props).toEqual({ role: 'x', ...stamp })   // the edge keeps its own properties and gets the stamp
  })

  it('stamps importedFrom on what a package bundle creates, so a second import finds it', async () => {
    await applyEntityOps(env, 'Transport:mtb-683', withOrigin('Transport:mtb-683', PACKAGE, [{ op: 'create-entity', kind: 'Transport', slug: 'mtb-683', props: { regser: '683' } }]), 'bundle:package-a-example:t', AT)
    expect(stmts()[0].parameters!.props).toEqual({ regser: '683', importedFrom: 'https://a.example/transport/mtb-683', originBundle: 'bundle:package-a-example:t', slug: 'mtb-683' })
  })

  it('stamps nothing from a sync bundle: it belongs to the bridge', async () => {
    await applyEntityOps(env, 'Operation:linge-pulje-4', withOrigin('Operation:linge-pulje-4', SYNC, [create]), 'bundle:sanity-event:t', AT)
    expect(stmts()[0].parameters!.props).toEqual({ canonicalName: 'Linge Pulje 4', slug: 'linge-pulje-4' })
    expect(stmts()[1].parameters!.props).toEqual({ role: 'x' })
  })

  it('stamps an added edge only when this op creates it, not one that was there', async () => {
    await applyEntityOps(env, 'Person:erik', withOrigin('Person:erik', OUTLINE, [{ op: 'add-edge', type: 'MEMBER_OF', from: 'Person:erik', to: 'Unit:linge', props: { role: 'operative' } }]), BUNDLE, AT)
    const [edge] = stmts()
    expect(edge.statement).toMatch(/MERGE \(a\)-\[r:`MEMBER_OF`\]->\(b\)\s+ON CREATE SET r \+= \$stamp\s+SET r \+= \$props/)
    expect(edge.parameters).toMatchObject({ props: { role: 'operative' }, stamp: { originOutline: 'linge-pulje-4', originSha: 'abc123', originBundle: BUNDLE, originSection: 'overview' } })
  })

  it('does not stamp what it only changes: a set-props leaves the origin of the entity as it was', async () => {
    await applyEntityOps(env, 'Operation:linge-pulje-4', withOrigin('Operation:linge-pulje-4', OUTLINE, [{ op: 'set-props', props: { codeName: { from: 'a', to: 'b' } } }]), BUNDLE, AT)
    expect(stmts()[0].parameters).toEqual({ slug: 'linge-pulje-4', set: { codeName: 'b' } })
  })
})

describe('archiving an outline: the obsolete-outline op records what was absorbed', () => {
  const archiveOp = [{ op: 'obsolete-outline', reason: 'fully absorbed' }]
  const stmts = () => tx.mock.calls[0][1] as { statement: string; parameters?: Record<string, unknown> }[]

  it('takes the hash from the outline bundle it is part of, and the bundle', async () => {
    const p = { ...payload('Outline:linge-pulje-4', archiveOp), derivedFrom: { outlineId: 'linge-pulje-4', outlineRev: 'abc123' } } as Parameters<typeof applyEntityOps>[2]
    await applyEntityOps(env, 'Outline:linge-pulje-4', p, 'bundle:linge-pulje-4:t', AT)
    expect(stmts()[0].statement).toContain('o.absorbedSha = $sha')
    expect(stmts()[0].parameters).toEqual({ slug: 'linge-pulje-4', at: AT, reason: 'fully absorbed', sha: 'abc123', bundle: 'bundle:linge-pulje-4:t' })
  })

  it('records no hash for a bundle that has none', async () => {
    await applyEntityOps(env, 'Outline:linge-pulje-4', payload('Outline:linge-pulje-4', archiveOp), 'bundle:x:t', AT)
    expect(stmts()[0].parameters!.sha).toBeNull()
  })
})

describe('create-entity: an entity that already exists', () => {
  const create = [{ op: 'create-entity', kind: 'Unit', slug: 'kompani-linge', props: {} }] as Parameters<typeof checkEntityExists>[2]

  it('is reported, so the entity is set aside instead of getting a second node', async () => {
    cypher.mockResolvedValue([{ n: 1 }] as never)
    expect(await checkEntityExists(env, 'Unit:kompani-linge', create)).toEqual([{ prop: 'entity', expected: null, actual: 'exists' }])
    expect(String(cypher.mock.calls[0][1])).toMatch(/MATCH \(n:`Unit` \{slug: \$slug\}\)/)
  })

  it('is fine when there is none, and asks nothing of a bundle that creates nothing', async () => {
    cypher.mockResolvedValue([{ n: 0 }] as never)
    expect(await checkEntityExists(env, 'Unit:kompani-linge', create)).toEqual([])
    cypher.mockClear()
    expect(await checkEntityExists(env, 'Unit:kompani-linge', [{ op: 'add-edge', type: 'PART_OF', from: 'Unit:kompani-linge', to: 'Unit:x' }] as never)).toEqual([])
    expect(cypher).not.toHaveBeenCalled()
  })

  it('looks a Source up by id', async () => {
    cypher.mockResolvedValue([{ n: 0 }] as never)
    await checkEntityExists(env, 'Source:granlund-rapport-1942', [{ op: 'create-entity', kind: 'Source', slug: 'granlund-rapport-1942', props: {} }] as never)
    expect(String(cypher.mock.calls[0][1])).toMatch(/\{id: \$slug\}/)
  })
})

describe('setting an entity aside when accept refuses it (#185)', () => {
  const BUNDLE = 'bundle:outline:2026-10-08T07:00:00.000Z'

  /** A bucket in memory: objects by key, an etag that changes with every write. */
  function bucket(objects: Record<string, unknown>) {
    const store = new Map<string, { body: string; etag: number; meta?: Record<string, string> }>(Object.entries(objects).map(([k, v]) => [k, { body: JSON.stringify(v), etag: 1 }]))
    return {
      store,
      PROPOSALS: {
        get: (key: string) => {
          const o = store.get(key)
          return Promise.resolve(o ? { httpEtag: `"${o.etag}"`, json: () => Promise.resolve(JSON.parse(o.body)) } : null)
        },
        head: (key: string) => {
          const o = store.get(key)
          return Promise.resolve(o ? { key, customMetadata: o.meta } : null)
        },
        put: (key: string, body: string, opts?: { customMetadata?: Record<string, string> }) => {
          const o = store.get(key)
          store.set(key, { body, etag: (o?.etag ?? 0) + 1, meta: opts?.customMetadata })
          return Promise.resolve({})
        },
      },
    }
  }

  const manifest = (statuses: string[]) => ({
    bundleId: BUNDLE, outlineId: 'linge', entities: statuses.map((status, i) => ({ entityId: `Article:a${i}`, status, opSummary: ['create'] })),
  })
  const idx = (ids: string[]) => ({ bundleIds: ids })
  /** The entity's record, as ingest writes it: pending, with what the bundle changes in the metadata. */
  const seedRecord = (b: ReturnType<typeof bucket>, entityId: string) =>
    b.PROPOSALS.put(recordKey(entityId, BUNDLE), '{}', { customMetadata: toMetadata(recordOf(BUNDLE, entityId, 'pending', [{ op: 'set-props', props: { title: {} } }])) })

  it('marks it drifted with the reason, and its record drifted with what the bundle changes kept', async () => {
    const b = bucket({
      [`proposals/bundles/${BUNDLE}/manifest.json`]: manifest(['pending', 'pending']),
      'proposals/by-outline/linge/index.json': idx([BUNDLE]),
    })
    await seedRecord(b, 'Article:a0')
    const after = await setAside(b as never, BUNDLE, 'Article:a0', [{ prop: 'entity', expected: null, actual: 'exists' }])
    expect(after.entities[0]).toMatchObject({ status: 'drifted', refusal: [{ prop: 'entity', actual: 'exists' }] })
    expect(b.store.get(recordKey('Article:a0', BUNDLE))!.meta).toMatchObject({ status: 'drifted', props: 'title' })
    // Another entity still waits: the bundle stays in its source index.
    expect(JSON.parse(b.store.get('proposals/by-outline/linge/index.json')!.body).bundleIds).toEqual([BUNDLE])
  })

  it('takes the bundle out of its source index when that was the last thing waiting', async () => {
    const b = bucket({
      [`proposals/bundles/${BUNDLE}/manifest.json`]: manifest(['pending']),
      'proposals/by-outline/linge/index.json': idx([BUNDLE]),
    })
    await setAside(b as never, BUNDLE, 'Article:a0', [{ prop: 'entity', expected: null, actual: 'exists' }])
    expect(JSON.parse(b.store.get('proposals/by-outline/linge/index.json')!.body).bundleIds).toEqual([])
  })

  it('leaves the refusal alone when an entity is denied after being set aside', async () => {
    const b = bucket({ [`proposals/bundles/${BUNDLE}/manifest.json`]: manifest(['pending']) })
    await setAside(b as never, BUNDLE, 'Article:a0', [{ prop: 'title', expected: 'a', actual: 'b' }])
    const after = await manifestSetStatus(b as never, BUNDLE, 'Article:a0', 'denied')
    expect(after.entities[0]).toMatchObject({ status: 'denied', refusal: [{ prop: 'title' }] })
  })
})

// A box or a table is one block for a bundle (#315): found by its key at the top, replaced whole, hashed whole.
describe('modify-block on a container', () => {
  const text = (key: string, t = key) => ({ _type: 'block', _key: key, children: [{ _type: 'span', _key: `${key}s`, text: t }] })
  const table = (cellText: string) => ({ _type: 'table', _key: 'tab1', rows: [{ _type: 'row', _key: 'r1', cells: [{ _type: 'cell', _key: 'c1', content: [text('x', cellText)] }] }] })
  const live = () => JSON.stringify([text('a'), table('Gammel'), text('z')])
  const modify = (newValue: unknown) => ({ op: 'modify-block', blockPath: 'section.crew.block.tab1', expectedSha: '', newValue })

  it('replaces the whole container, leaves the blocks around it, and keeps the old container as previousValue with its sha', async () => {
    graph({ descriptions: [{ descId: 'd1', content: live() }] })
    await applyEntityOps(env, 'Transport:mtb-683', payload('Transport:mtb-683', [modify(table('Ny'))]), 'b', AT)
    const [, , params] = writes()[0]
    expect(JSON.parse(String((params as Row).content))).toEqual([text('a'), table('Ny'), text('z')])
    expect((params as Row).previousValue).toBe(JSON.stringify(table('Gammel')))
    expect((params as Row).previousSha).toBe(await stableSha(table('Gammel')))
    expect(statements().find(s => s.includes('SET d.content'))).toContain("d.previousKind   = 'block'")
  })

  it('finds no drift when the live container has the sha the proposal saw, however its JSON is written', async () => {
    graph({ descriptions: [{ descId: 'd1', content: JSON.stringify([text('a'), table('Gammel')], null, 2) }] })
    const sha = await stableSha(table('Gammel'))
    expect(await checkDrift(env, 'Transport:mtb-683', [modify(table('Ny'))] as never, { 'section.crew.block.tab1': sha })).toEqual([])
  })

  it('reports drift when a cell changed inside the container, with the live container as the current value', async () => {
    graph({ descriptions: [{ descId: 'd1', content: JSON.stringify([text('a'), table('Endret av en annen')]) }] })
    const seen = await stableSha(table('Gammel'))
    const drift = await checkDrift(env, 'Transport:mtb-683', [modify(table('Ny'))] as never, { 'section.crew.block.tab1': seen })
    expect(drift).toEqual([{ blockPath: 'section.crew.block.tab1', expectedSha: seen, actualSha: await stableSha(table('Endret av en annen')), currentValue: table('Endret av en annen') }])
  })

  it('hands the new container to the link guard as a description, like any block', async () => {
    await checkOpLinks(env, 'Transport:mtb-683', [modify(table('Ny'))] as never)
    expect(vi.mocked(judgeStored).mock.calls[0][2]).toEqual([JSON.stringify([table('Ny')])])
  })
})
