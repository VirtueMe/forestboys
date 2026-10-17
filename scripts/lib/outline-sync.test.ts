import { describe, expect, it } from 'vitest'
import { sha, type Doc } from './person-sync.ts'
import {
  LEFT_ALONE, classifyOutline, newOutlineProps, planOutline, sanityPeople, sanityTitle, sanityValue, stampsFor, type GraphOutline,
} from './outline-sync.ts'

const IMG = 'image-53ef960aa94abfc891b4186f911d3bc5493c336f-1014x1024-png'
const KNOWN = new Set(['p1', 'p2', 'p3'])
const doc = (over: Record<string, unknown> = {}): Doc => ({
  _id: 'o1', _rev: 'rev1', _updatedAt: '2026-10-04T14:13:19Z', title: ' Olga ', slug: { current: 'olga' },
  people: [{ _ref: 'p2' }, { _ref: 'p1' }, { _ref: 'gone' }, { _ref: 'p1' }], gallery: [{ asset: { _ref: IMG } }], ...over,
})
const node = (over: Partial<GraphOutline> = {}): GraphOutline => ({
  sanityId: 'o1', slug: 'olga', canonicalName: 'Olga', mentions: ['p1', 'p2'], imageRefs: [IMG], stamps: {}, ...over,
})
const verdict = (v: ReturnType<typeof classifyOutline>, field: string) => v.find(x => x.field === field)?.verdict

describe('values', () => {
  it('trims the title and falls back to the slug', () => {
    expect(sanityTitle(doc())).toBe('Olga')
    expect(sanityTitle(doc({ title: '  ' }))).toBe('olga')
  })

  it('names the people the graph has, once, sorted', () => {
    expect(sanityPeople(doc(), KNOWN)).toEqual(['p1', 'p2'])
    expect(sanityValue(doc(), 'gallery', KNOWN)).toBe(IMG)
  })
})

describe('classifyOutline', () => {
  it('leaves out what Sanity has not changed since the stamps', () => {
    const s = doc()
    expect(classifyOutline(node({ stamps: stampsFor(s, KNOWN) }), s, KNOWN)).toEqual([])
  })

  it('finds a node already right and only stamps it', () => {
    const v = classifyOutline(node(), doc(), KNOWN)
    expect(v.map(x => x.verdict)).toEqual(['already', 'already', 'already'])
  })

  it('takes a field the graph has nothing for', () => {
    const v = classifyOutline(node({ imageRefs: [], mentions: [] }), doc(), KNOWN)
    expect(verdict(v, 'gallery')).toBe('clean')
    expect(verdict(v, 'people')).toBe('clean')
  })

  it('applies a title Sanity changed while the graph holds the stamped one, and holds an edited title', () => {
    const was = doc({ title: 'Old' }), stamps = stampsFor(was, KNOWN)
    expect(verdict(classifyOutline(node({ canonicalName: 'Old', stamps }), doc(), KNOWN), 'title')).toBe('clean')
    expect(verdict(classifyOutline(node({ canonicalName: 'Mine', stamps }), doc(), KNOWN), 'title')).toBe('conflict')
  })

  it('without a stamp: clean from the baseline, conflict, or review without one', () => {
    const base = doc({ title: 'Old' })
    expect(verdict(classifyOutline(node({ canonicalName: 'Old' }), doc(), KNOWN, base), 'title')).toBe('clean')
    expect(verdict(classifyOutline(node({ canonicalName: 'Mine' }), doc(), KNOWN, base), 'title')).toBe('conflict')
    expect(verdict(classifyOutline(node({ canonicalName: 'Old' }), doc(), KNOWN), 'title')).toBe('review')
  })

  it('never calls a mention a conflict: the missing ones are added', () => {
    const was = doc({ people: [{ _ref: 'p1' }] }), stamps = stampsFor(was, KNOWN)
    const v = classifyOutline(node({ mentions: ['p3'], stamps }), doc(), KNOWN)
    expect(verdict(v, 'people')).toBe('clean')
    expect(verdict(classifyOutline(node({ mentions: ['p1', 'p2', 'p3'], stamps }), doc(), KNOWN), 'people')).toBe('already')
  })
})

describe('planOutline', () => {
  it('writes the title, the people to join and the gallery, with the stamps of what it took', () => {
    const s = doc()
    const g = node({ canonicalName: 'Old', mentions: ['p1'], imageRefs: [] })
    const row = planOutline(g, s, [{ field: 'title', verdict: 'review' }, { field: 'people', verdict: 'clean' }, { field: 'gallery', verdict: 'clean' }], KNOWN, [])!
    expect(row.props).toEqual({})
    expect(row.people).toEqual(['p1', 'p2'])
    expect(row.gallery?.map(i => i.assetRef)).toEqual([IMG])
    expect(Object.keys(row.stamps).sort()).toEqual(['gallery_sha', 'people_sha'])
  })

  it('holds a conflict and a review', () => {
    const held: string[] = []
    expect(planOutline(node(), doc(), [{ field: 'title', verdict: 'conflict' }, { field: 'gallery', verdict: 'review' }], KNOWN, held)).toBeNull()
    expect(held).toEqual(['olga: title (conflict)', 'olga: gallery (review)'])
  })
})

describe('a new outline', () => {
  it('gets the import\'s node with its stamps', () => {
    const p = newOutlineProps(doc(), KNOWN)
    expect(p).toMatchObject({ slug: 'olga', canonicalName: 'Olga', sanityId: 'o1', sanityRev: 'rev1', title_sha: sha('Olga'), people_sha: sha('p1\np2'), gallery_sha: sha(IMG) })
  })

  it('leaves the Linge members outline alone', () => {
    expect(LEFT_ALONE.has('917b8cb9-6a12-4a96-91eb-8444691d6797')).toBe(true)
  })
})
