import { describe, expect, it } from 'vitest'
import { makeEntitySnapshot, makePackage, type EntitySnapshot } from './bundle-package.ts'
import { descriptionSha, diffEntity, diffPackage, type DiffOp, type LiveEntity } from './snapshot-diff.ts'
import { stableSha } from './stable-sha.ts'

const SITE = 'https://archive.example'
const blocks = (...texts: string[]) => JSON.stringify(texts.map((t, i) => ({ _type: 'block', _key: `k${i}`, style: 'normal', children: [{ _type: 'span', _key: 's', text: t }] })))

const snapshot = (over: Partial<EntitySnapshot> = {}): EntitySnapshot => ({
  ...makeEntitySnapshot({
    kind: 'Transport', key: 'mtb-683',
    props: { canonicalName: 'MTB 683', regser: '683' },
    descriptions: [{ order: 1, content: blocks('Første avsnitt.') }],
    edges: [{ type: 'USED_BY', to: 'Unit:54-mtb-flotilla', props: { from: '1943' } }],
    source: { site: SITE, path: '/transport/mtb-683' },
  }),
  ...over,
})

/** The live entity that already holds the snapshot, as the graph would return it: with the bridge's bookkeeping on it. */
const liveOf = (s: EntitySnapshot): LiveEntity => ({
  props: { ...s.props, slug: s.key, sanityId: 'abc', description_sha: 'ff', lat_sourceRef: 'sanity-migration:transport:abc:coordinates' },
  descriptions: s.descriptions.map(d => ({ ...d })),
  edges: s.edges.map(e => ({ ...e })),
})

const opsOf = (ops: DiffOp[]) => ops.map(o => o.op)

/** A tiny model of what accepting the ops does, to see that a second comparison finds nothing left. */
function accept(live: LiveEntity | null, ops: DiffOp[]): LiveEntity {
  const out: LiveEntity = live ? structuredClone(live) : { props: {}, descriptions: [], edges: [] }
  for (const o of ops) {
    if (o.op === 'create-entity') { out.props = { ...o.props }; out.descriptions = structuredClone(o.descriptions); out.edges = structuredClone(o.edges) }
    if (o.op === 'set-props') for (const [k, v] of Object.entries(o.props)) { if (v.to === null) delete out.props[k]; else out.props[k] = v.to }
    if (o.op === 'set-description') {
      const d = out.descriptions.find(x => x.order === o.order)
      if (d) d.content = o.content; else out.descriptions.push({ order: o.order, content: o.content })
    }
    if (o.op === 'add-edge') {
      const e = out.edges.find(x => x.type === o.type && x.to === o.to)
      if (e) e.props = { ...e.props, ...o.props }; else out.edges.push({ type: o.type, to: o.to, ...(o.props ? { props: o.props } : {}) })
    }
    if (o.op === 'remove-edge') out.edges = out.edges.filter(x => !(x.type === o.type && x.to === o.to))
  }
  return out
}

describe('diffEntity: an entity the graph does not have', () => {
  it('is created, with its properties, text and edges, and nothing from the bridge', async () => {
    const ops = await diffEntity(snapshot(), null)
    expect(ops).toEqual([{
      op: 'create-entity', kind: 'Transport', slug: 'mtb-683',
      props: { canonicalName: 'MTB 683', regser: '683' },
      edges: [{ type: 'USED_BY', to: 'Unit:54-mtb-flotilla', props: { from: '1943' } }],
      descriptions: [{ order: 1, content: blocks('Første avsnitt.') }],
    }])
    expect(JSON.stringify(ops)).not.toMatch(/sanity|_sha/i)
  })

  it('leaves out a null property: there is nothing to remove from something new', async () => {
    const [op] = await diffEntity(snapshot({ props: { canonicalName: 'MTB 683', regser: null } }), null)
    expect(op).toMatchObject({ props: { canonicalName: 'MTB 683' } })
    expect((op as Extract<DiffOp, { op: 'create-entity' }>).props).not.toHaveProperty('regser')
  })
})

describe('diffEntity: an entity the graph already has', () => {
  it('finds nothing to do when it holds what the snapshot says, whatever the bridge has put on the node', async () => {
    expect(await diffEntity(snapshot(), liveOf(snapshot()))).toEqual([])
  })

  it('leaves alone what only the live entity has: its own properties, descriptions and edges', async () => {
    const live = liveOf(snapshot())
    live.props.localNote = 'ours'
    live.descriptions.push({ order: 2, content: blocks('Vårt eget avsnitt.') })
    live.edges.push({ type: 'CREW_OF', to: 'Person:ours-only' })
    expect(await diffEntity(snapshot(), live)).toEqual([])
  })

  it('changes a property with the value it replaces, so a later edit is seen as drift', async () => {
    const live = liveOf(snapshot())
    live.props.regser = '682'
    expect(await diffEntity(snapshot(), live)).toEqual([{ op: 'set-props', props: { regser: { from: '682', to: '683' } } }])
  })

  it('adds a property the live entity lacks (from: null), and removes one the snapshot sets to null', async () => {
    const live = liveOf(snapshot())
    delete live.props.regser
    live.props.rawUnit = '54 MTB flotilla'
    const ops = await diffEntity(snapshot({ props: { canonicalName: 'MTB 683', regser: '683', rawUnit: null } }), live)
    expect(ops).toEqual([{ op: 'set-props', props: { regser: { from: null, to: '683' }, rawUnit: { from: '54 MTB flotilla', to: null } } }])
  })

  it('replaces a description that differs, with the sha of what it replaces', async () => {
    const live = liveOf(snapshot())
    live.descriptions[0].content = blocks('Et annet avsnitt.')
    expect(await diffEntity(snapshot(), live)).toEqual([{
      op: 'set-description', order: 1, expectedSha: await stableSha(JSON.parse(blocks('Et annet avsnitt.'))), content: blocks('Første avsnitt.'),
    }])
  })

  it('creates a description the live entity lacks, with an empty expectedSha', async () => {
    const live = liveOf(snapshot())
    live.descriptions = []
    expect(await diffEntity(snapshot(), live)).toEqual([{ op: 'set-description', order: 1, expectedSha: '', content: blocks('Første avsnitt.') }])
  })

  it('does not call a description changed because its JSON is written differently', async () => {
    const live = liveOf(snapshot())
    live.descriptions[0].content = JSON.stringify(JSON.parse(blocks('Første avsnitt.')), null, 2)
    expect(await diffEntity(snapshot(), live)).toEqual([])
    expect(await descriptionSha(JSON.stringify(JSON.parse(blocks('x')), null, 2))).toBe(await descriptionSha(blocks('x')))
  })

  it('adds a missing edge, and an edge whose properties differ (the apply merges them)', async () => {
    const live = liveOf(snapshot())
    live.edges = [{ type: 'USED_BY', to: 'Unit:54-mtb-flotilla', props: { from: '1942' } }]
    const s = snapshot({ edges: [
      { type: 'CREW_OF', to: 'Person:anderssen-erik' },
      { type: 'USED_BY', to: 'Unit:54-mtb-flotilla', props: { from: '1943' } },
    ] })
    expect(await diffEntity(s, live)).toEqual([
      { op: 'add-edge', type: 'CREW_OF', from: 'Transport:mtb-683', to: 'Person:anderssen-erik' },
      { op: 'add-edge', type: 'USED_BY', from: 'Transport:mtb-683', to: 'Unit:54-mtb-flotilla', props: { from: '1943' } },
    ])
  })

  it('removes live edges only of the types the caller says the snapshot is the whole truth about', async () => {
    const live = liveOf(snapshot())
    live.edges.push({ type: 'MEMBER_OF', to: 'Unit:old' }, { type: 'CREW_OF', to: 'Person:ours-only' })
    expect(await diffEntity(snapshot(), live)).toEqual([])
    expect(await diffEntity(snapshot(), live, { authoritativeEdgeTypes: ['MEMBER_OF'] })).toEqual([
      { op: 'remove-edge', type: 'MEMBER_OF', from: 'Transport:mtb-683', to: 'Unit:old' },
    ])
  })

  it('gives the ops in a fixed order: properties, descriptions, edges', async () => {
    const live: LiveEntity = { props: {}, descriptions: [], edges: [] }
    expect(opsOf(await diffEntity(snapshot(), live))).toEqual(['set-props', 'set-description', 'add-edge'])
  })

  it('does not change what it was given', async () => {
    const s = snapshot(); const live = liveOf(s); live.props.regser = '1'
    const before = structuredClone({ s, live })
    await diffEntity(s, live, { authoritativeEdgeTypes: ['USED_BY'] })
    expect({ s, live }).toEqual(before)
  })
})

describe('importing twice', () => {
  it('finds nothing the second time, for something new and for something changed', async () => {
    const created = accept(null, await diffEntity(snapshot(), null))
    expect(await diffEntity(snapshot(), created)).toEqual([])

    const live = liveOf(snapshot())
    live.props.regser = '1'; live.descriptions[0].content = blocks('Gammelt.'); live.edges = []
    const changed = accept(live, await diffEntity(snapshot(), live))
    expect(await diffEntity(snapshot(), changed)).toEqual([])
  })

  it('finds only the difference when a newer package comes', async () => {
    const first = accept(null, await diffEntity(snapshot(), null))
    const newer = snapshot({ props: { canonicalName: 'MTB 683', regser: '683B' } })
    expect(await diffEntity(newer, first)).toEqual([{ op: 'set-props', props: { regser: { from: '683', to: '683B' } } }])
  })
})

describe('diffPackage', () => {
  const other = makeEntitySnapshot({ kind: 'Person', key: 'anderssen-erik', props: { canonicalName: 'Erik Anderssen' }, source: { site: SITE, path: '/person/anderssen-erik' } })
  const pkg = makePackage({ site: SITE, madeAt: '2026-10-07T12:00:00Z' }, [snapshot(), other])

  it('lists what changes, what is already there, and notes a match by slug alone', async () => {
    const result = await diffPackage(pkg, s => s.kind === 'Transport'
      ? { live: liveOf(snapshot()), linked: true }               // already holds it
      : { live: { props: { canonicalName: 'E. Andersen' }, descriptions: [], edges: [] }, linked: false })   // same slug, not imported from here
    expect(result.unchanged).toEqual(['Transport:mtb-683'])
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({
      entityId: 'Person:anderssen-erik',
      ops: [{ op: 'set-props', props: { canonicalName: { from: 'E. Andersen', to: 'Erik Anderssen' } } }],
      source: { site: SITE, path: '/person/anderssen-erik' },
    })
    expect(result.entities[0].note).toContain('was not imported from https://archive.example/person/anderssen-erik')
  })

  it('makes a create for what is missing, with no note', async () => {
    const result = await diffPackage(pkg, () => ({ live: null, linked: false }))
    expect(result.entities.map(e => [e.entityId, opsOf(e.ops), e.note])).toEqual([
      ['Person:anderssen-erik', ['create-entity'], undefined],
      ['Transport:mtb-683', ['create-entity'], undefined],
    ])
    expect(result.unchanged).toEqual([])
  })
})
