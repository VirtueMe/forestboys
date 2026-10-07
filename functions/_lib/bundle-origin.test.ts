import { describe, expect, it } from 'vitest'
import { bundleChannel, originLabel, siteSlug, sourceIndexKey, validateDerivedFrom, validateOrigin } from './bundle-origin.ts'

const SITE = 'https://archive.example'
const NOW  = '2026-10-07T12:00:00.000Z'

describe('siteSlug', () => {
  it('makes a piece of a channel or a bundle id out of a site address', () => {
    expect(siteSlug('https://Archive.example')).toBe('archive-example')
    expect(siteSlug('http://localhost:5173/')).toBe('localhost-5173')
    expect(siteSlug('???')).toBe('site')
  })
})

describe('the package origin', () => {
  const origin = { origin: { type: 'package', site: SITE, madeAt: NOW } }

  it('is accepted, and is a channel and an index of its own', () => {
    const o = validateOrigin(origin)
    expect(o).toEqual({ origin: { type: 'package', site: SITE, madeAt: NOW } })
    if (typeof o === 'string') return
    expect(bundleChannel(o)).toBe('package-archive-example')
    expect(sourceIndexKey(o)).toBe('proposals/by-source/package-archive-example/index.json')
    expect(originLabel(o)).toBe('package from https://archive.example')
  })

  it('needs the address of the archive and a time', () => {
    expect(validateOrigin({ origin: { type: 'package', site: 'archive.example', madeAt: NOW } })).toContain('origin.site')
    expect(validateOrigin({ origin: { type: 'package', site: SITE } })).toContain('origin.madeAt')
  })

  it('leaves the two origins that were there as they were', () => {
    expect(validateOrigin({ outlineId: 'linge-pulje-4', outlineRev: 'r1' })).toEqual({ outlineId: 'linge-pulje-4', outlineRev: 'r1' })
    expect(validateOrigin({ origin: { type: 'sanity', sanityType: 'event', runAt: NOW } })).toEqual({ origin: { type: 'sanity', sanityType: 'event', runAt: NOW } })
    expect(validateOrigin({ origin: { type: 'nope' } })).toContain('"sanity" | "package"')
    const sanity = validateOrigin({ origin: { type: 'sanity', sanityType: 'event', runAt: NOW } }) as Parameters<typeof originLabel>[0]
    expect(originLabel(sanity)).toBe('Sanity event')
    expect(bundleChannel(sanity)).toBe('sanity-event')
  })

  it('wants each entity to say where it lives in the archive it came from', () => {
    const o = validateOrigin(origin) as Parameters<typeof validateDerivedFrom>[0]
    expect(validateDerivedFrom(o, { source: { site: SITE, path: '/transport/mtb-683' } })).toEqual({ source: { site: SITE, path: '/transport/mtb-683' } })
    expect(validateDerivedFrom(o, { source: { site: SITE, path: 'transport/mtb-683' } })).toContain('must start with /')
    expect(validateDerivedFrom(o, { source: {} })).toContain('source.site')
    expect(validateDerivedFrom(o, { sanityId: 'x', sanityRev: 'y' })).toContain('source.site')   // not what a package carries
    expect(validateDerivedFrom(o, undefined)).toBe('derivedFrom required')
  })
})
