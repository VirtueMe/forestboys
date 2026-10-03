import { describe, expect, it } from 'vitest'
import { stableSha } from './stable-sha.ts'

describe('stableSha', () => {
  it('is a 64-char hex sha256', async () => {
    expect(await stableSha({ a: 1 })).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does not depend on object key order, at any depth', async () => {
    const a = await stableSha({ x: 1, y: { b: 2, a: [1, { d: 4, c: 3 }] } })
    const b = await stableSha({ y: { a: [1, { c: 3, d: 4 }], b: 2 }, x: 1 })
    expect(a).toBe(b)
  })

  it('treats array order as meaningful', async () => {
    expect(await stableSha([1, 2])).not.toBe(await stableSha([2, 1]))
  })

  it('changes when a value changes', async () => {
    expect(await stableSha({ a: 1 })).not.toBe(await stableSha({ a: 2 }))
  })

  it('matches a known sha256 for a primitive', async () => {
    // sha256 of the JSON text `"abc"` (with quotes)
    expect(await stableSha('abc')).toBe('6cc43f858fbb763301637b5af970e2a46b46f461f27e5a0f41e009c59b827b25')
  })
})
