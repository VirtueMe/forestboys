import { describe, expect, it } from 'vitest'
import { sha, type Doc } from './person-sync.ts'
import {
  DISTRICT, LEFT_TO_JAN, ORGANIZATION, classifyOrg, newOrgProps, parseOrgName, planOrg, propsFor, sanityValue, slugify, stampsFor,
  type GraphOrg,
} from './org-sync.ts'

const org = (over: Record<string, unknown> = {}): Doc => ({
  _id: 'o1', _updatedAt: '2026-10-04T14:13:19Z', name: '09-Catalina trafikken', color: { _type: 'color', hex: '#627202' }, ...over,
})
const district = (over: Record<string, unknown> = {}): Doc => ({ _id: 'd1', _updatedAt: '2026-10-04T14:13:19Z', name: 'Holland', ...over })
const node = (over: Partial<GraphOrg> = {}): GraphOrg => ({
  sanityId: 'o1', sanityUpdatedAt: '2026-04-08T07:36:48Z', slug: 'catalina-trafikken', canonicalName: 'Catalina trafikken',
  sortPrefix: '09', color: '#627202', stamps: {}, ...over,
})
const verdict = (v: ReturnType<typeof classifyOrg>, field: string) => v.find(x => x.field === field)?.verdict

describe('the import rule', () => {
  it('spells æ ø å out and turns anything else into a hyphen', () => {
    expect(slugify('Hæren')).toBe('haeren')
    expect(slugify('Svenska Röda Korset')).toBe('svenska-r-da-korset')
    expect(slugify('Avd D. "Mi IV"')).toBe('avd-d-mi-iv')
    expect(slugify('Skøyter på Ålesund')).toBe('skoyter-paa-aalesund')
  })

  it('splits a sort prefix off an organization\'s name', () => {
    expect(parseOrgName('09-Catalina trafikken')).toEqual({ slug: 'catalina-trafikken', canonical: 'Catalina trafikken', sortPrefix: '09', raw: '09-Catalina trafikken' })
    expect(parseOrgName('3- Hæren')).toMatchObject({ canonical: 'Hæren', sortPrefix: '3', slug: 'haeren' })
    expect(parseOrgName('COHQ')).toEqual({ slug: 'cohq', canonical: 'COHQ', sortPrefix: null, raw: 'COHQ' })
  })

  it('does not bring Kompani Linge in', () => {
    expect(LEFT_TO_JAN.has('bc2e9f77-64f5-470e-b743-2b6fbe0663f7')).toBe(true)
  })
})

describe('classifyOrg', () => {
  it('leaves out a field Sanity has not changed since its stamp', () => {
    const s = org()
    expect(classifyOrg(ORGANIZATION, node({ stamps: stampsFor(ORGANIZATION, s) }), s)).toEqual([])
  })

  it('compares the sort prefix with the name, so a new number is a change', () => {
    const before = org()
    const stamps = stampsFor(ORGANIZATION, before)
    const v = classifyOrg(ORGANIZATION, node({ stamps }), org({ name: '10-Catalina trafikken' }))
    expect(verdict(v, 'name')).toBe('clean')
    expect(verdict(v, 'color')).toBeUndefined()
  })

  it('applies a Sanity change while the graph holds the stamped value, and holds it when the graph was edited', () => {
    const stamps = stampsFor(ORGANIZATION, org())
    const changed = org({ color: { hex: '#000000' } })
    expect(verdict(classifyOrg(ORGANIZATION, node({ stamps }), changed), 'color')).toBe('clean')
    expect(verdict(classifyOrg(ORGANIZATION, node({ stamps, color: '#ffffff' }), changed), 'color')).toBe('conflict')
  })

  it('moves only the stamp when the graph already holds the new value', () => {
    const stamps = stampsFor(ORGANIZATION, org())
    expect(verdict(classifyOrg(ORGANIZATION, node({ stamps, color: '#000000' }), org({ color: { hex: '#000000' } })), 'color')).toBe('already')
  })

  it('without a stamp: already, kept, clean from the baseline, conflict, review', () => {
    const s = org({ _updatedAt: '2026-10-04T00:00:00Z' })
    expect(verdict(classifyOrg(ORGANIZATION, node(), s), 'name')).toBe('already')
    const edited = node({ canonicalName: 'Catalina' })
    expect(verdict(classifyOrg(ORGANIZATION, edited, org({ _updatedAt: edited.sanityUpdatedAt! })), 'name')).toBe('kept')
    const base = org({ _updatedAt: edited.sanityUpdatedAt!, name: '09-Catalina' })
    expect(verdict(classifyOrg(ORGANIZATION, edited, s, base), 'name')).toBe('clean')
    expect(verdict(classifyOrg(ORGANIZATION, node({ canonicalName: 'Annet' }), s, base), 'name')).toBe('conflict')
    expect(verdict(classifyOrg(ORGANIZATION, edited, s), 'name')).toBe('review')
  })

  it('compares a district by its trimmed name only', () => {
    const g = node({ canonicalName: 'Holland', sortPrefix: null, color: null, slug: 'holland' })
    const v = classifyOrg(DISTRICT, g, district({ name: ' Holland ' }))
    expect(v).toEqual([{ field: 'name', verdict: 'already' }])
  })
})

describe('planOrg', () => {
  const held: string[] = []
  it('writes the name\'s three properties for a clean change and moves the stamp', () => {
    const s = org({ name: '10-Catalina trafikken' })
    const g = node({ stamps: stampsFor(ORGANIZATION, org()) })
    const row = planOrg(ORGANIZATION, g, s, classifyOrg(ORGANIZATION, g, s), held)!
    expect(row.props).toEqual({ canonicalName: 'Catalina trafikken', sortPrefix: '10', rawName: '10-Catalina trafikken' })
    expect(row.stamps).toEqual({ name_sha: sha('10|Catalina trafikken') })
    expect(row.at).toBe(s._updatedAt)
  })

  it('removes a colour Sanity no longer has, and a sort prefix it no longer has', () => {
    expect(propsFor(ORGANIZATION, org({ color: undefined }), 'color')).toEqual({ color: null })
    expect(propsFor(ORGANIZATION, org({ name: 'Catalina trafikken' }), 'name').sortPrefix).toBeNull()
  })

  it('holds a conflict, and keeps sanityUpdatedAt back for a review', () => {
    const h: string[] = []
    const g = node()
    const s = org({ name: '09-Annet' })
    const row = planOrg(ORGANIZATION, g, s, [{ field: 'name', verdict: 'review' }, { field: 'color', verdict: 'conflict' }], h)
    expect(row).toBeNull()
    expect(h).toEqual(['catalina-trafikken: name (review)', 'catalina-trafikken: color (conflict)'])
  })

  it('never takes an empty name', () => {
    const h: string[] = []
    const row = planOrg(DISTRICT, node({ slug: 'holland' }), district({ name: '  ' }), [{ field: 'name', verdict: 'clean' }], h)
    expect(row).toBeNull()
    expect(h[0]).toContain('empty in Sanity')
  })
})

describe('newOrgProps', () => {
  it('makes an organization by the import\'s rule, with stamps', () => {
    expect(newOrgProps(ORGANIZATION, org())).toEqual({
      slug: 'catalina-trafikken', sanityId: 'o1', sanityUpdatedAt: '2026-10-04T14:13:19Z',
      canonicalName: 'Catalina trafikken', sortPrefix: '09', rawName: '09-Catalina trafikken', color: '#627202',
      name_sha: sha('09|Catalina trafikken'), color_sha: sha('#627202'),
    })
  })

  it('makes a district a Unit of type district', () => {
    expect(newOrgProps(DISTRICT, district({ name: 'D41-Finnmark' }))).toEqual({
      slug: 'd41-finnmark', sanityId: 'd1', sanityUpdatedAt: '2026-10-04T14:13:19Z', type: 'district',
      canonicalName: 'D41-Finnmark', name_sha: sha('D41-Finnmark'),
    })
  })

  it('reads the name the way both sides compare it', () => {
    expect(sanityValue(DISTRICT, district({ name: ' Holland ' }), 'name')).toBe('Holland')
    expect(sanityValue(ORGANIZATION, org({ name: 'COHQ' }), 'name')).toBe('|COHQ')
  })
})
