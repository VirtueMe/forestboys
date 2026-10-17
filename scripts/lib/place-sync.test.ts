import { describe, expect, it } from 'vitest'
import { sha, type Doc } from './person-sync.ts'
import {
  LOCATION, STATION, classifyPlace, coordinatesKey, newPlaceProps, planPlace, propsFor, sanityValue, stampsFor,
  type GraphPlace, type PlacePlan,
} from './place-sync.ts'

const IMG = 'image-53ef960aa94abfc891b4186f911d3bc5493c336f-1014x1024-png'
const doc = (over: Record<string, unknown> = {}): Doc => ({
  _id: 'loc1', _updatedAt: '2026-10-04T14:13:19Z', title: 'Lamholmen', slug: { current: 'lamholmen' },
  coordinates: { _type: 'geopoint', lat: 59.747372, lng: 5.210006 }, gallery: [{ asset: { _ref: IMG } }], ...over,
})
const place = (over: Partial<GraphPlace> = {}): GraphPlace => ({
  sanityId: 'loc1', sanityUpdatedAt: '2026-04-08T07:36:48Z', slug: 'lamholmen', canonicalName: 'Lamholmen',
  lat: 59.747372, lng: 5.210006, type: null, imageRefs: [IMG], stamps: {}, ...over,
})
const verdict = (v: ReturnType<typeof classifyPlace>, field: string) => v.find(x => x.field === field)?.verdict

describe('values', () => {
  it('compares coordinates to 6 decimals and leaves none as empty', () => {
    expect(coordinatesKey(59.74666666666667, 5.216666666666667)).toBe('59.746667,5.216667')
    expect(coordinatesKey(undefined, 5)).toBe('')
  })

  it('tidies a name and a type, and reads a gallery as its assets in order', () => {
    expect(sanityValue(doc({ title: '  Grøterud  seter ' }), 'name')).toBe('Grøterud seter')
    expect(sanityValue(doc({ type: 'Airfield ' }), 'type')).toBe('Airfield')
    expect(sanityValue(doc(), 'gallery')).toBe(IMG)
  })
})

describe('classifyPlace', () => {
  it('leaves out a field Sanity has not changed since its stamp', () => {
    const s = doc()
    expect(classifyPlace(LOCATION, place({ stamps: stampsFor(LOCATION, s) }), s)).toEqual([])
  })

  it('applies a Sanity change while the graph holds the stamped value, and holds it when the graph was edited', () => {
    const before = doc({ coordinates: { lat: 59.746667, lng: 5.216667 } })
    const stamps = stampsFor(LOCATION, before)
    expect(verdict(classifyPlace(LOCATION, place({ lat: 59.746667, lng: 5.216667, stamps }), doc()), 'coordinates')).toBe('clean')
    expect(verdict(classifyPlace(LOCATION, place({ lat: 60, lng: 5, stamps }), doc()), 'coordinates')).toBe('conflict')
  })

  it('without a stamp: already, kept when Sanity has not moved, review when it has and there is no baseline', () => {
    expect(verdict(classifyPlace(LOCATION, place(), doc()), 'coordinates')).toBe('already')
    const edited = place({ lat: 60, lng: 5 })
    expect(verdict(classifyPlace(LOCATION, edited, doc({ _updatedAt: edited.sanityUpdatedAt })), 'coordinates')).toBe('kept')
    expect(verdict(classifyPlace(LOCATION, edited, doc()), 'coordinates')).toBe('review')
  })

  it('takes the export the graph was imported from as the baseline: clean if the graph kept it, conflict if not', () => {
    const g = place({ lat: 59.746667, lng: 5.216667 })
    const base = doc({ _updatedAt: g.sanityUpdatedAt, coordinates: { lat: 59.746667, lng: 5.216667 } })
    expect(verdict(classifyPlace(LOCATION, g, doc(), base), 'coordinates')).toBe('clean')
    expect(verdict(classifyPlace(LOCATION, place({ lat: 61, lng: 5 }), doc(), base), 'coordinates')).toBe('conflict')
    // An export of another version is no baseline.
    expect(verdict(classifyPlace(LOCATION, g, doc(), { ...base, _updatedAt: '2026-04-20T00:00:00Z' }), 'coordinates')).toBe('review')
  })

  it('has type only for a station', () => {
    expect(LOCATION.fields).not.toContain('type')
    expect(verdict(classifyPlace(STATION, place({ type: 'Airfield ' }), doc({ type: 'Airfield' })), 'type')).toBe('already')
  })
})

describe('planPlace', () => {
  const empty = (): PlacePlan => ({ rows: [], galleries: [], renames: [], held: [] })

  it('writes a clean coordinate, gallery and slug, and stamps what it took', () => {
    const plan = empty()
    const s = doc({ slug: { current: 'lamholmen-ny' }, gallery: [] })
    planPlace(LOCATION, place(), s, [
      { field: 'coordinates', verdict: 'clean' }, { field: 'gallery', verdict: 'clean' }, { field: 'slug', verdict: 'clean' },
    ], plan)
    expect(plan.rows[0].props).toMatchObject({ lat: 59.747372, lng: 5.210006, lat_state: 'candidate' })
    expect(plan.rows[0].stamps).toEqual({ coordinates_sha: sha('59.747372,5.210006'), gallery_sha: sha(''), slug_sha: sha('lamholmen-ny') })
    expect(plan.galleries).toEqual([{ id: 'loc1', images: [] }])
    expect(plan.renames).toEqual([{ id: 'loc1', from: 'lamholmen', to: 'lamholmen-ny' }])
  })

  it('stamps an already field without writing it, unless its name needs tidying', () => {
    const plan = empty()
    planPlace(LOCATION, place({ canonicalName: 'Lamholmen ' }), doc(), [{ field: 'name', verdict: 'already' }, { field: 'coordinates', verdict: 'already' }], plan)
    expect(plan.rows[0].props).toEqual({ canonicalName: 'Lamholmen' })
  })

  it('holds conflicts and reviews, keeps sanityUpdatedAt while a review is held, and never takes an empty name', () => {
    const plan = empty()
    planPlace(LOCATION, place(), doc({ title: '' }), [
      { field: 'name', verdict: 'clean' }, { field: 'coordinates', verdict: 'review' }, { field: 'gallery', verdict: 'conflict' },
    ], plan)
    expect(plan.held).toEqual(['lamholmen: name (empty in Sanity)', 'lamholmen: coordinates (review)', 'lamholmen: gallery (conflict)'])
    expect(plan.rows).toEqual([])
  })
})

describe('new places', () => {
  it('get the import\'s properties and every stamp', () => {
    const p = newPlaceProps(STATION, doc({ _id: 'st1', type: 'Airfield ', slug: { current: 'raf-bassingbourn' } }))
    expect(p).toMatchObject({ slug: 'raf-bassingbourn', sanityId: 'st1', canonicalName: 'Lamholmen', lat: 59.747372, type: 'Airfield', type_state: 'candidate' })
    expect(Object.keys(p).filter(k => k.endsWith('_sha')).sort()).toEqual(['coordinates_sha', 'gallery_sha', 'name_sha', 'slug_sha', 'type_sha'])
    expect(propsFor(LOCATION, doc({ coordinates: null }), 'coordinates')).toMatchObject({ lat: null, lng: null, lat_state: null })
  })
})
