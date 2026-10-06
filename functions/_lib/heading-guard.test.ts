import { describe, expect, it } from 'vitest'
import { guardHeadings } from './heading-guard.ts'

const content = (...styles: string[]) => JSON.stringify(styles.map((style, i) => ({
  _key: `k${i}`, _type: 'block', style, children: [{ _key: 's', _type: 'span', text: `T${i}` }],
})))

describe('guardHeadings', () => {
  it('lets a valid description through', () => {
    expect(guardHeadings([{ order: 1, content: content('h3', 'h4', 'normal') }])).toBeNull()
    expect(guardHeadings([])).toBeNull()
  })

  it('refuses with 422 and the headings, each with a message', async () => {
    const res = guardHeadings([{ order: 1, content: content('h1', 'h5') }])!
    expect(res.status).toBe(422)
    const body = await res.json<{ error: string; headings: { reason: string; message: string; level: number }[] }>()
    expect(body.error).toMatch(/overskrifter/)
    expect(body.headings.map(h => [h.reason, h.level])).toEqual([['too-shallow', 1], ['too-deep', 5]])
    expect(body.headings[0].message).toContain('H1')
  })

  it('reads the sections in order, not as sent', () => {
    // sent second-first: by `order` the h3 comes before the h4, which is fine
    expect(guardHeadings([{ order: 2, content: content('h4') }, { order: 1, content: content('h3') }])).toBeNull()
    // the other way round the h4 is first and too deep
    expect(guardHeadings([{ order: 1, content: content('h4') }, { order: 2, content: content('h3') }])!.status).toBe(422)
  })

  it('takes the section level as an option', () => {
    expect(guardHeadings([{ order: 1, content: content('h4') }], { sectionLevel: 3 })).toBeNull()
    expect(guardHeadings([{ order: 1, content: content('h3') }], { sectionLevel: 3 })!.status).toBe(422)
  })
})
