import { describe, expect, it } from 'vitest'
import { missingAssets } from './image-backfill-graph.ts'

describe('missingAssets', () => {
  it('compares by Source id, so a photo already copied (url on our bucket) is not missing', () => {
    expect(missingAssets(['image-a-1x1-png', 'image-b-2x2-jpg', 'image-c-3x3-gif'], ['img:sanity:image-a-1x1-png', 'img:sanity:image-b-2x2-jpg']))
      .toEqual(['image-c-3x3-gif'])
  })
  it('lists nothing when every referenced asset has a Source', () => {
    expect(missingAssets(new Set(['image-a-1x1-png']), ['img:sanity:image-a-1x1-png'])).toEqual([])
  })
})
