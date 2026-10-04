import { describe, expect, it } from 'vitest'
import { planSections, validateSections, type CleanSection } from './event-sections.ts'

const block = JSON.stringify([{ _type: 'block', children: [{ _type: 'span', text: 'x' }] }])
const sec = (order: number, over: Partial<CleanSection> = {}): CleanSection =>
  ({ order, content: block, citations: [], sourcedFromId: null, ...over })

describe('validateSections', () => {
  it('accepts sections, fills defaults and sorts by order', () => {
    const r = validateSections([{ order: 2, content: block }, { order: 1, content: block, sourcedFromId: 's1', citations: [{ inline: true, sourceId: 'a' }] }])
    expect(r).toEqual({ sections: [
      { order: 1, content: block, citations: [{ inline: true, sourceId: 'a' }], sourcedFromId: 's1' },
      { order: 2, content: block, citations: [], sourcedFromId: null },
    ] })
  })

  it('accepts an empty list (removes the description)', () => {
    expect(validateSections([])).toEqual({ sections: [] })
  })

  it.each([
    ['not an array', 'x', /array/],
    ['a bad order', [{ order: 0, content: block }], /order/],
    ['a fractional order', [{ order: 1.5, content: block }], /order/],
    ['a repeated order', [{ order: 1, content: block }, { order: 1, content: block }], /twice/],
    ['content that is not a string', [{ order: 1, content: 3 }], /content/],
    ['content that is not JSON', [{ order: 1, content: '{nope' }], /JSON/],
    ['citations that are not a list', [{ order: 1, content: block, citations: 'a' }], /citations/],
    ['a citation without a source', [{ order: 1, content: block, citations: [{ inline: true, sourceId: '' }] }], /sourceId/],
    ['a citation without inline', [{ order: 1, content: block, citations: [{ sourceId: 'a' }] }], /inline/],
    ['a bad sourcedFromId', [{ order: 1, content: block, sourcedFromId: 7 }], /sourcedFromId/],
  ])('rejects %s', (_name, input, message) => {
    const r = validateSections(input)
    expect('error' in r && r.error).toMatch(message)
  })
})

describe('planSections', () => {
  const IMPORTED = 'desc:event:7f5eed41-8fde-47ef-b799-883abf4e7cdd'

  it('updates the imported node in place, keeping its id', () => {
    const plan = planSections('nrk-1', [{ id: IMPORTED, order: 1 }], [sec(1)])
    expect(plan.update.map(u => u.id)).toEqual([IMPORTED])
    expect(plan.create).toEqual([])
    expect(plan.deleteIds).toEqual([])
  })

  it('creates a new slot with an id from the slug and the order', () => {
    const plan = planSections('nrk-1', [{ id: IMPORTED, order: 1 }], [sec(1), sec(2)])
    expect(plan.create.map(c => c.id)).toEqual(['desc:event:nrk-1:2'])
  })

  it('creates every section for an event with no description yet', () => {
    const plan = planSections('nrk-1', [], [sec(1), sec(2)])
    expect(plan.create.map(c => c.id)).toEqual(['desc:event:nrk-1:1', 'desc:event:nrk-1:2'])
    expect(plan.update).toEqual([])
  })

  it('deletes the nodes of slots that are gone', () => {
    const plan = planSections('nrk-1', [{ id: IMPORTED, order: 1 }, { id: 'desc:event:nrk-1:2', order: 2 }], [sec(1)])
    expect(plan.deleteIds).toEqual(['desc:event:nrk-1:2'])
    expect(plan.update.map(u => u.id)).toEqual([IMPORTED])
  })

  it('removes everything when the editor empties the description', () => {
    const plan = planSections('nrk-1', [{ id: IMPORTED, order: 1 }], [])
    expect(plan.deleteIds).toEqual([IMPORTED])
    expect(plan.update).toEqual([])
    expect(plan.create).toEqual([])
  })

  it('keeps one node per slot and deletes a second one in the same slot', () => {
    const plan = planSections('nrk-1', [{ id: 'desc:event:b', order: 1 }, { id: 'desc:event:a', order: 1 }], [sec(1)])
    expect(plan.update.map(u => u.id)).toEqual(['desc:event:a'])
    expect(plan.deleteIds).toEqual(['desc:event:b'])
  })

  it('treats a stored order of 1.0 as slot 1', () => {
    const plan = planSections('nrk-1', [{ id: IMPORTED, order: 1.0 }], [sec(1)])
    expect(plan.update.map(u => u.id)).toEqual([IMPORTED])
  })
})
