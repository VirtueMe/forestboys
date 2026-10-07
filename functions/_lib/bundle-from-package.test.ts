import { describe, expect, it } from 'vitest'
import { makeEntitySnapshot, makePackage } from './bundle-package.ts'
import { buildBundleBody, siteSlug } from './bundle-from-package.ts'
import { diffPackage } from './snapshot-diff.ts'

const SITE = 'https://Archive.example'
const NOW  = '2026-10-07T12:00:00.000Z'
const person = makeEntitySnapshot({ kind: 'Person', key: 'anderssen-erik', props: { canonicalName: 'Erik Anderssen' }, source: { site: SITE, path: '/person/anderssen-erik' } })
const transport = makeEntitySnapshot({ kind: 'Transport', key: 'mtb-683', props: { regser: '683' }, source: { site: SITE, path: '/transport/mtb-683' } })
const pkg = makePackage({ site: SITE, madeAt: '2026-10-07T11:00:00Z', filter: 'two entities' }, [person, transport])

describe('siteSlug', () => {
  it('makes a piece of a bundle id out of a site address', () => {
    expect(siteSlug('https://Archive.example')).toBe('archive-example')
    expect(siteSlug('http://localhost:5173/')).toBe('localhost-5173')
    expect(siteSlug('???')).toBe('site')
  })
})

describe('buildBundleBody', () => {
  it('is null when the graph already holds everything', async () => {
    const diff = await diffPackage(pkg, s => ({ live: { props: s.props, descriptions: [], edges: [] }, linked: true }))
    expect(buildBundleBody(pkg, diff, NOW)).toBeNull()
  })

  it('is a bundle of the package origin, with a valid bundle id, a summary and one entity per change', async () => {
    const diff = await diffPackage(pkg, s => s.kind === 'Person'
      ? { live: { props: { canonicalName: 'E. Andersen' }, descriptions: [], edges: [] }, linked: false }
      : { live: null, linked: false })
    const body = buildBundleBody(pkg, diff, NOW)!
    expect(body.bundleId).toBe('bundle:package-archive-example:2026-10-07T12:00:00.000Z')
    expect(body.bundleId).toMatch(/^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/)         // what ingest accepts (functions/api/proposals/ingest.ts)
    expect(body.origin).toEqual({ type: 'package', site: SITE, madeAt: '2026-10-07T11:00:00Z' })
    expect(body.summary).toBe('Import from https://Archive.example (two entities): 1 new, 1 changed.')
    expect(body.model).toBe('none')
    expect(body.entities.map(e => [e.entityId, e.ops.map(o => o.op)])).toEqual([
      ['Person:anderssen-erik', ['set-props']],
      ['Transport:mtb-683', ['create-entity']],
    ])
    expect(body.entities[0]).toMatchObject({
      derivedFrom: { source: { site: SITE, path: '/person/anderssen-erik' } },
      source: 'package:https://Archive.example/person/anderssen-erik',
      generatedAt: NOW,
    })
    expect(body.entities[0].note).toContain('proposed as the same entity')   // matched by slug alone
    expect(body.entities[1]).not.toHaveProperty('note')
  })

  it('counts the entities that were already up to date', async () => {
    const diff = await diffPackage(pkg, s => s.kind === 'Person'
      ? { live: { props: { canonicalName: 'Erik Anderssen' }, descriptions: [], edges: [] }, linked: true }
      : { live: null, linked: false })
    expect(buildBundleBody(pkg, diff, NOW)!.summary).toBe('Import from https://Archive.example (two entities): 1 new, 1 already up to date.')
  })

  it('carries no Sanity id, revision or stamp', async () => {
    const diff = await diffPackage(pkg, () => ({ live: null, linked: false }))
    expect(JSON.stringify(buildBundleBody(pkg, diff, NOW))).not.toMatch(/sanity|_sha/i)
  })
})
