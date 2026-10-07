import { describe, expect, it } from 'vitest'
import {
  entityPath, isBridgeProp, makeEntitySnapshot, makePackage, PACKAGE_SCHEMA_VERSION, refOf, stripBridgeProps, validatePackage,
  type BundlePackage, type EntityInput,
} from './bundle-package.ts'

const SITE = 'https://archive.example'
const source = (path: string) => ({ site: SITE, path })

/** A transport as the graph holds it: content, the sync bridge's bookkeeping and the identity property. */
const graphTransport: EntityInput = {
  kind: 'Transport',
  key:  'mtb-683',
  props: {
    slug: 'mtb-683', canonicalName: 'MTB 683', rawUnit: '54 MTB flotilla', regser: '683',
    sanityId: 'abc-123', sanityUpdatedAt: '2026-05-11T10:00:00Z', description_sha: 'ff00', links_sha: 'ee11',
    description_sanityUpdatedAt: '2026-05-11T10:00:00Z', lat_state: 'candidate', lat_sourceRef: 'sanity-migration:transport:abc-123:coordinates',
  },
  descriptions: [{ order: 2, content: '[{"_type":"block","_key":"b"}]' }, { order: 1, content: '[{"_type":"block","_key":"a"}]' }],
  edges: [
    { type: 'USED_BY', to: 'Unit:54-mtb-flotilla', props: { from: '1943', sanityRev: 'r1' } },
    { type: 'CREW_OF', to: 'Person:anderssen-erik' },
  ],
  source: source('/transport/mtb-683'),
}

describe('isBridgeProp', () => {
  it('names the sync bridge\'s bookkeeping and nothing that is content', () => {
    for (const name of ['sanityId', 'sanityRev', 'sanityImportedAt', 'sanityUpdatedAt', 'sanitySha', 'sanityOutlineId',
      'description_sanityUpdatedAt', 'description_sha', 'links_sha', 'date_sha', 'sha', 'lat_sourceRef', 'description_sourceRef']) expect(isBridgeProp(name), name).toBe(true)
    for (const name of ['canonicalName', 'rawUnit', 'regser', 'lat', 'lat_state', 'description_state',
      'shape', 'shadow', 'role', 'startDate', 'description_state']) expect(isBridgeProp(name), name).toBe(false)
  })
})

describe('stripBridgeProps', () => {
  it('keeps the content and reports what it took out', () => {
    expect(stripBridgeProps({ a: 1, sanityId: 'x', links_sha: 'y', b: null })).toEqual({ kept: { a: 1, b: null }, dropped: ['sanityId', 'links_sha'] })
  })
})

describe('makeEntitySnapshot', () => {
  const snapshot = makeEntitySnapshot(graphTransport)

  it('carries no Sanity id, revision or hash stamp, anywhere in it', () => {
    const text = JSON.stringify(snapshot)
    expect(text).not.toMatch(/sanity/i)
    expect(text).not.toMatch(/_sha|"sha"/)
    expect(snapshot.props).toEqual({
      canonicalName: 'MTB 683', rawUnit: '54 MTB flotilla', regser: '683', lat_state: 'candidate',
    })
  })

  it('takes the identity out of the properties: the key is the identity', () => {
    expect(snapshot.key).toBe('mtb-683')
    expect(snapshot.props).not.toHaveProperty('slug')
    expect(refOf(snapshot)).toBe('Transport:mtb-683')
  })

  it('puts descriptions and edges in a fixed order and strips bookkeeping from edge props too', () => {
    expect(snapshot.descriptions.map(d => d.order)).toEqual([1, 2])
    expect(snapshot.edges).toEqual([
      { type: 'CREW_OF', to: 'Person:anderssen-erik' },
      { type: 'USED_BY', to: 'Unit:54-mtb-flotilla', props: { from: '1943' } },
    ])
  })

  it('gives the same snapshot however the graph returned the rows', () => {
    const shuffled = makeEntitySnapshot({ ...graphTransport, descriptions: [...graphTransport.descriptions!].reverse(), edges: [...graphTransport.edges!].reverse() })
    expect(shuffled).toEqual(snapshot)
  })

  it('does not change what it was given', () => {
    const input = structuredClone(graphTransport)
    makeEntitySnapshot(input)
    expect(input).toEqual(graphTransport)
  })

  it('keeps a Source by its id', () => {
    const s = makeEntitySnapshot({ kind: 'Source', key: 'granlund-rapport-1942', props: { id: 'granlund-rapport-1942', title: 'Granlund-rapporten', license: 'cc-by' }, source: source('/source/granlund-rapport-1942') })
    expect(s.props).toEqual({ title: 'Granlund-rapporten', license: 'cc-by' })
    expect(refOf(s)).toBe('Source:granlund-rapport-1942')
  })
})

describe('makePackage', () => {
  it('sorts the entities, so the same selection gives the same package', () => {
    const a = makeEntitySnapshot({ kind: 'Person', key: 'b-person', props: {}, source: source('/person/b-person') })
    const b = makeEntitySnapshot(graphTransport)
    const origin = { site: SITE, madeAt: '2026-10-07T12:00:00Z', filter: 'two entities' }
    expect(makePackage(origin, [b, a])).toEqual(makePackage(origin, [a, b]))
    expect(makePackage(origin, [b, a]).entities.map(refOf)).toEqual(['Person:b-person', 'Transport:mtb-683'])
    expect(makePackage(origin, []).schemaVersion).toBe(PACKAGE_SCHEMA_VERSION)
  })
})

describe('validatePackage', () => {
  const good = (): BundlePackage => makePackage({ site: SITE, madeAt: '2026-10-07T12:00:00Z' }, [makeEntitySnapshot(graphTransport)])

  it('accepts what makePackage made, after a round trip through JSON', () => {
    expect(validatePackage(JSON.parse(JSON.stringify(good())))).toEqual([])
  })

  it('refuses a package that carries the bridge\'s bookkeeping, in a prop or in an edge prop', () => {
    const p = good()
    p.entities[0].props.sanityId = 'abc-123'
    p.entities[0].props.links_sha = 'ee11'
    p.entities[0].edges[1].props = { sanityRev: 'r1' }
    const problems = validatePackage(p)
    expect(problems.filter(x => x.includes('bookkeeping'))).toHaveLength(3)
    expect(problems.join('\n')).toContain('«sanityId»')
    expect(problems.join('\n')).toContain('edge prop «sanityRev»')
  })

  it('refuses a missing schema version, site, source ref or path', () => {
    const p = good()
    ;(p as { schemaVersion: number }).schemaVersion = 2
    p.origin.site = ''
    p.entities[0].source = { site: '', path: 'transport/mtb-683' }
    const text = validatePackage(p).join('\n')
    expect(text).toContain('schemaVersion must be 1')
    expect(text).toContain('origin.site is required')
    expect(text).toContain('source.site is required')
    expect(text).toContain('source.path must start with /')
  })

  it('refuses a key that travels as a property, a duplicate, a bad edge and a description that is not blocks', () => {
    const p = good()
    p.entities[0].props.slug = 'mtb-683'
    p.entities.push(structuredClone(p.entities[0]))
    p.entities[0].edges.push({ type: 'lower', to: 'not a ref' })
    p.entities[0].descriptions.push({ order: 1, content: 'plain text' })
    p.entities[0].descriptions.push({ order: 3, content: '{"a":1}' })
    const text = validatePackage(p).join('\n')
    expect(text).toContain('«slug» is the key')
    expect(text).toContain('appears twice')
    expect(text).toContain('an edge needs a type')
    expect(text).toContain('not a <Kind>:<key> reference')
    expect(text).toContain('description order 1 appears twice')
    expect(text).toContain('is not JSON')
    expect(text).toContain('is not a list of blocks')
  })

  it('refuses what is not a package', () => {
    expect(validatePackage(null)).toEqual(['the package is not an object'])
    expect(validatePackage({ schemaVersion: 1, origin: { site: SITE, madeAt: 'x' }, entities: 'no' })).toContain('entities must be a list')
  })
})

describe('entityPath', () => {
  it('follows the routes of the application, and is null where a kind has no page', () => {
    expect(entityPath('Transport', 'mtb-683')).toBe('/transport/mtb-683')
    expect(entityPath('Person', 'a-b')).toBe('/person/a-b')
    expect(entityPath('Operation', 'x')).toBe('/events/x')
    expect(entityPath('Incident', 'x')).toBe('/events/x')
    expect(entityPath('Unit', 'eksportgruppe-torsvik')).toBe('/outlines/eksportgruppe-torsvik')
    expect(entityPath('EquipmentType', 'olga')).toBe('/equipment/olga')
    expect(entityPath('Article', 'code-names')).toBeNull()
    expect(entityPath('Source', 'granlund-rapport-1942')).toBeNull()
  })
})
