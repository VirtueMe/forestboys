import { describe, expect, it } from 'vitest'
import { makeEntitySnapshot, makePackage } from './bundle-package.ts'
import { buildBundleBody } from './bundle-from-package.ts'
import { diffPackage } from './snapshot-diff.ts'
import { ENTITY_KINDS, summarizeOp, validateBundle, type BundleOp, type IngestBody } from './bundle-validate.ts'

const NOW = '2026-10-07T12:00:00.000Z'

/** A bundle the bot makes from an outline. */
const outlineBundle = (over: Partial<Record<string, unknown>> = {}): IngestBody => ({
  bundleId: `bundle:linge-pulje-4:${NOW}`,
  outlineId: 'linge-pulje-4',
  outlineRev: 'rev-abc',
  summary: 'Absorb Pulje 4',
  createdAt: NOW,
  model: 'claude-opus-4-7',
  promptHash: 'abc123',
  entities: [{
    entityId: 'Operation:linge-pulje-4',
    ops: [{ op: 'create-entity', kind: 'Operation', slug: 'linge-pulje-4', props: { canonicalName: 'Linge Pulje 4' },
            edges: [{ type: 'ORCHESTRATED_BY', to: 'Organization:soe' }],
            descriptions: [{ order: 1, content: '[{"_type":"block","_key":"a","children":[]}]' }] }],
    derivedFrom: { outlineId: 'linge-pulje-4', outlineRev: 'rev-abc', sectionPath: 'overview' },
    source: 'claude:outline:linge-pulje-4:overview',
    generatedAt: NOW,
  }],
  ...over,
})

/** A bundle the Sanity sync makes. */
const syncBundle = (): IngestBody => ({
  bundleId: `bundle:sanity-event:${NOW}`,
  origin: { type: 'sanity', sanityType: 'event', runAt: NOW },
  summary: 'Sync of events',
  createdAt: NOW,
  model: 'sync',
  promptHash: 'none',
  entities: [{
    entityId: 'Operation:am-468',
    ops: [{ op: 'set-props', props: { codeName: { from: 'AM 468', to: 'AM 468 BRIDLE' } } }],
    derivedFrom: { sanityId: 'abc', sanityRev: 'r1' },
    source: 'sanity:abc',
    generatedAt: NOW,
  }],
})

const reason = (b: IngestBody) => { const v = validateBundle(b); return typeof v === 'string' ? v : null }

describe('validateBundle: what ingest accepts today', () => {
  it('accepts an outline bundle, and describes each entity by its ops', () => {
    const v = validateBundle(outlineBundle())
    expect(typeof v).toBe('object')
    if (typeof v === 'string') return
    expect(v.manifest).toMatchObject({ bundleId: `bundle:linge-pulje-4:${NOW}`, outlineId: 'linge-pulje-4', outlineRev: 'rev-abc', model: 'claude-opus-4-7' })
    expect(v.manifest.entities).toEqual([{ entityId: 'Operation:linge-pulje-4', status: 'pending', opSummary: ['create (+1 edge)'] }])
    expect([...v.payloads.keys()]).toEqual(['Operation:linge-pulje-4'])
    expect(v.payloads.get('Operation:linge-pulje-4')!.source).toBe('claude:outline:linge-pulje-4:overview')
  })

  it('accepts a Sanity sync bundle', () => {
    const v = validateBundle(syncBundle())
    expect(typeof v).toBe('object')
    if (typeof v === 'string') return
    expect(v.manifest.origin).toEqual({ type: 'sanity', sanityType: 'event', runAt: NOW })
    expect(v.manifest.entities[0].opSummary).toEqual(['codeName: «AM 468» → «AM 468 BRIDLE»'])
  })

  it('refuses a bundle id that does not start with its channel', () => {
    expect(reason(outlineBundle({ bundleId: `bundle:other:${NOW}` }))).toBe('bundleId must start with bundle:linge-pulje-4:')
    expect(reason(outlineBundle({ bundleId: 'not-a-bundle' }))).toContain('bundleId must match')
  })

  it('refuses a bundle without a model, a prompt hash or entities', () => {
    expect(reason(outlineBundle({ model: '' }))).toBe('model required')
    expect(reason(outlineBundle({ promptHash: undefined }))).toBe('promptHash required')
    expect(reason(outlineBundle({ entities: [] }))).toBe('entities must be a non-empty array')
  })

  it('refuses an unknown kind, an unknown op and a create-entity whose kind and slug are not the entity id', () => {
    const entity = (patch: (e: Record<string, unknown>) => void) => {
      const b = outlineBundle(); patch((b.entities as Record<string, unknown>[])[0]); return b
    }
    expect(reason(entity(e => { e.entityId = 'Gadget:x' }))).toContain('unknown kind: Gadget')
    expect(reason(entity(e => { e.ops = [{ op: 'explode' }] }))).toContain('must be one of')
    expect(reason(entity(e => { (e.ops as Record<string, unknown>[])[0].slug = 'other' }))).toContain("must match the entity's entityId")
  })

  it('refuses set-props on an identity property, and a modify-block with a malformed path', () => {
    const b = syncBundle(); ;((b.entities as Record<string, unknown>[])[0].ops as unknown[]) = [{ op: 'set-props', props: { sanityId: { from: 'a', to: 'b' } } }]
    expect(reason(b)).toContain('property "sanityId" not allowed')
    const m = syncBundle(); ;((m.entities as Record<string, unknown>[])[0].ops as unknown[]) = [{ op: 'modify-block', blockPath: 'nope', expectedSha: '', newValue: { _type: 'block', children: [] } }]
    expect(reason(m)).toContain('blockPath must match')
  })

  it('refuses a derivedFrom that does not fit the origin', () => {
    const b = outlineBundle(); ;(b.entities as Record<string, unknown>[])[0].derivedFrom = { sanityId: 'x', sanityRev: 'y' }
    expect(reason(b)).toContain('derivedFrom must include outlineId + outlineRev')
  })
})

/** A bundle made from a package, with the given ops on one entity. */
const packageBundle = (ops: unknown[], over: Partial<Record<string, unknown>> = {}): IngestBody => ({
  bundleId: `bundle:package-archive-example:${NOW}`,
  origin: { type: 'package', site: 'https://archive.example', madeAt: NOW },
  summary: 'Import from https://archive.example: 1 changed.',
  createdAt: NOW,
  entities: [{
    entityId: 'Transport:mtb-683',
    ops,
    derivedFrom: { source: { site: 'https://archive.example', path: '/transport/mtb-683' } },
    source: 'package:https://archive.example/transport/mtb-683',
    generatedAt: NOW,
  }],
  ...over,
})
const BLOCKS = '[{"_type":"block","_key":"a","children":[]}]'
const setDescription = (over: Record<string, unknown> = {}) => ({ op: 'set-description', order: 1, expectedSha: 'abc', content: BLOCKS, ...over })
const entityOf = (b: IngestBody) => (b.entities as Record<string, unknown>[])[0]

describe('set-description', () => {
  it('is accepted, for an existing text and for a new one', () => {
    expect(reason(packageBundle([setDescription()]))).toBeNull()
    expect(reason(packageBundle([setDescription({ expectedSha: '' })]))).toBeNull()
  })

  it('says in the summary whether it replaces a text or makes one', () => {
    expect(summarizeOp(setDescription() as BundleOp)).toBe('description 1: replaced')
    expect(summarizeOp(setDescription({ expectedSha: '', order: 2 }) as BundleOp)).toBe('description 2: new')
  })

  it('needs an order of 1 or more, an expectedSha, and content that is a JSON list of blocks', () => {
    expect(reason(packageBundle([setDescription({ order: 0 })]))).toContain('order must be int >= 1')
    expect(reason(packageBundle([setDescription({ order: 1.5 })]))).toContain('order must be int >= 1')
    expect(reason(packageBundle([setDescription({ expectedSha: undefined })]))).toContain('expectedSha required')
    expect(reason(packageBundle([setDescription({ content: undefined })]))).toContain('content must be a string')
    expect(reason(packageBundle([setDescription({ content: 'plain text' })]))).toContain('must be JSON')
    expect(reason(packageBundle([setDescription({ content: '{"a":1}' })]))).toContain('JSON array of blocks')
  })

  it('works in an outline bundle too: it is an op, not a privilege of packages', () => {
    const b = outlineBundle(); entityOf(b).ops = [setDescription()]
    expect(reason(b)).toBeNull()
  })
})

describe('the kinds a package and the conversion of earlier absorptions need', () => {
  it('are Article, EquipmentType and Source, besides the nine that were there', () => {
    for (const k of ['Person', 'Unit', 'Station', 'Transport', 'Operation', 'Incident', 'Location', 'Outline', 'Organization', 'Article', 'EquipmentType', 'Source']) {
      expect(ENTITY_KINDS.has(k), k).toBe(true)
    }
    expect(ENTITY_KINDS.size).toBe(12)
  })

  it('can be created by a bundle', () => {
    for (const [kind, slug] of [['Article', 'code-names'], ['EquipmentType', 'olga'], ['Source', 'granlund-rapport-1942']]) {
      const b = packageBundle([{ op: 'create-entity', kind, slug, props: { title: 'x' } }])
      entityOf(b).entityId = `${kind}:${slug}`
      expect(reason(b), kind).toBeNull()
    }
  })

  it('does not take a Source whose id is not slug-like (an image source has colons)', () => {
    const b = packageBundle([{ op: 'create-entity', kind: 'Source', slug: 'img:sanity:image-abc', props: {} }])
    entityOf(b).entityId = 'Source:img:sanity:image-abc'
    expect(reason(b)).toContain('must match `<Kind>:<slug>`')
  })
})

describe('a bundle made from a package', () => {
  it('needs no model and no prompt, and gets «none»', () => {
    const v = validateBundle(packageBundle([setDescription()]))
    expect(typeof v).toBe('object')
    if (typeof v === 'string') return
    expect(v.manifest).toMatchObject({ model: 'none', promptHash: 'none', origin: { type: 'package', site: 'https://archive.example', madeAt: NOW } })
    expect(v.payloads.get('Transport:mtb-683')).toMatchObject({
      derivedFrom: { source: { site: 'https://archive.example', path: '/transport/mtb-683' } },
      source: 'package:https://archive.example/transport/mtb-683',
    })
  })

  it('still needs the model and the prompt when it is not a package', () => {
    expect(reason(outlineBundle({ model: undefined }))).toBe('model required')
  })

  it('carries the note of an entity matched by slug alone into the review', () => {
    const b = packageBundle([setDescription()]); entityOf(b).note = 'Transport:mtb-683 exists here, but was not imported from https://archive.example/transport/mtb-683: proposed as the same entity'
    const v = validateBundle(b)
    if (typeof v === 'string') throw new Error(v)
    expect(v.manifest.entities[0].opSummary).toEqual(['description 1: replaced', '⚠ Transport:mtb-683 exists here, but was not imported from https://archive.example/transport/mtb-683: proposed as the same entity'])
    expect(v.payloads.get('Transport:mtb-683')!.note).toContain('proposed as the same entity')
  })

  it('must start its bundle id with the channel of its site', () => {
    expect(reason(packageBundle([setDescription()], { bundleId: `bundle:package-other-site:${NOW}` }))).toBe('bundleId must start with bundle:package-archive-example:')
  })
})

describe('the sync bridge\'s bookkeeping is refused from a package', () => {
  const create = (props: Record<string, unknown>, edges?: unknown[]) => [{ op: 'create-entity', kind: 'Transport', slug: 'mtb-683', props, ...(edges ? { edges } : {}) }]

  it('in the properties of a new entity, naming every one', () => {
    const r = reason(packageBundle(create({ canonicalName: 'MTB 683', sanityId: 'abc', description_sha: 'ff', lat_sourceRef: 'sanity-migration:x:y:coordinates' })))
    expect(r).toContain('«sanityId», «description_sha», «lat_sourceRef» are the sync bridge')
  })

  it('in a set-props, on an edge of a new entity, and on an add-edge', () => {
    expect(reason(packageBundle([{ op: 'set-props', props: { sanityUpdatedAt: { from: null, to: 'x' } } }]))).toContain('«sanityUpdatedAt» is the sync bridge')
    expect(reason(packageBundle(create({ canonicalName: 'x' }, [{ type: 'USED_BY', to: 'Unit:a', props: { sanityRev: 'r' } }])))).toContain('«sanityRev»')
    expect(reason(packageBundle([{ op: 'add-edge', type: 'USED_BY', from: 'Transport:mtb-683', to: 'Unit:a', props: { links_sha: 'x' } }]))).toContain('«links_sha»')
  })

  it('also the archive\'s own history: importedFrom and the origin stamps', () => {
    expect(reason(packageBundle(create({ importedFrom: 'https://x/y', originOutline: 'a' })))).toContain('«importedFrom», «originOutline»')
  })

  it('not from a bundle that is not a package: those are as they were', () => {
    const b = outlineBundle(); ;((entityOf(b).ops as Record<string, unknown>[])[0].props as Record<string, unknown>).sanityId = 'abc'
    expect(reason(b)).toBeNull()
  })

  it('and lets the properties that are content through', () => {
    expect(reason(packageBundle(create({ canonicalName: 'MTB 683', rawUnit: '54 MTB flotilla', lat_state: 'candidate' })))).toBeNull()
  })
})

describe('a bundle that scripts/bundles/package-to-bundle.ts writes', () => {
  const SITE = 'https://archive.example'
  const snapshot = (key: string, props: Record<string, unknown>) =>
    makeEntitySnapshot({ kind: 'Transport', key, props, descriptions: [{ order: 1, content: BLOCKS }], edges: [{ type: 'USED_BY', to: 'Unit:54-mtb-flotilla', props: { from: '1943' } }], source: { site: SITE, path: `/transport/${key}` } })
  const pkg = makePackage({ site: SITE, madeAt: NOW, filter: 'transports' }, [snapshot('mtb-683', { regser: '683' }), snapshot('mtb-684', { regser: '684' })])

  it('is ingested as it is: a new entity, a changed property, a changed description, a new edge', async () => {
    const live = { props: { regser: '682' }, descriptions: [{ order: 1, content: '[{"_type":"block","_key":"old","children":[]}]' }], edges: [] }
    const diff = await diffPackage(pkg, s => s.key === 'mtb-683' ? { live, linked: false } : { live: null, linked: false })
    const body = buildBundleBody(pkg, diff, NOW)!
    expect(body.entities.map(e => e.ops.map(o => o.op))).toEqual([['set-props', 'set-description', 'add-edge'], ['create-entity']])

    const v = validateBundle(JSON.parse(JSON.stringify(body)) as IngestBody)
    if (typeof v === 'string') throw new Error(v)
    expect(v.manifest.bundleId).toBe(body.bundleId)
    expect(v.manifest.origin).toEqual({ type: 'package', site: SITE, madeAt: NOW })
    expect(v.manifest.entities.map(e => e.entityId)).toEqual(['Transport:mtb-683', 'Transport:mtb-684'])
    expect(v.manifest.entities[0].opSummary[0]).toBe('regser: «682» → «683»')
    expect(v.manifest.entities[0].opSummary.at(-1)).toContain('proposed as the same entity')   // matched by slug alone
  })
})
