import { describe, expect, it } from 'vitest'
import { fakeBucket } from '../_lib/fake-r2.ts'
import { displayKey, masterKey } from '../_lib/images.ts'
import { onRequestGet } from './[[path]].ts'

const ID = 'b'.repeat(40)

async function get(bucket: R2Bucket, path: string[], query = '') {
  const res = await onRequestGet({
    params:  { path },
    env:     { IMAGES: bucket },
    request: new Request(`https://x.test/images/${path.join('/')}${query}`),
  } as unknown as Parameters<typeof onRequestGet>[0])
  return res
}

async function seeded(...sizes: (400 | 900)[]) {
  const { bucket, store } = fakeBucket()
  for (const s of sizes) {
    await bucket.put(displayKey(ID, s), new Response(`size-${s}`).body, { httpMetadata: { contentType: 'image/webp' } })
  }
  await bucket.put(masterKey(ID, 'png'), new Response('master').body)
  await bucket.put('_meta/copied.json', new Response('{}').body)
  await bucket.put('cards/c-1.jpg', new Response('card').body, { httpMetadata: { contentType: 'image/jpeg' } })
  return { bucket, store }
}

describe('GET /images/<id>', () => {
  it('serves the 900 file with no w, and for w=600', async () => {
    const { bucket } = await seeded(400, 900)
    expect(await (await get(bucket, [ID])).text()).toBe('size-900')
    expect(await (await get(bucket, [ID], '?w=600')).text()).toBe('size-900')
  })

  it('serves the 400 file for w up to 400', async () => {
    const { bucket } = await seeded(400, 900)
    expect(await (await get(bucket, [ID], '?w=400')).text()).toBe('size-400')
    expect(await (await get(bucket, [ID], '?w=1')).text()).toBe('size-400')
  })

  it('falls back to the size the image has', async () => {
    const { bucket } = await seeded(400)
    expect(await (await get(bucket, [ID])).text()).toBe('size-400')
    expect(await (await get(bucket, [ID], '?w=700')).text()).toBe('size-400')
  })

  it('caches for good and sets the type', async () => {
    const { bucket } = await seeded(900)
    const res = await get(bucket, [ID])
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('content-type')).toBe('image/webp')
  })

  it('is 404 for an unknown id', async () => {
    const { bucket } = await seeded(900)
    expect((await get(bucket, ['c'.repeat(40)])).status).toBe(404)
  })
})

describe('GET /images/<key>', () => {
  it('still serves a public key as it is', async () => {
    const { bucket } = await seeded()
    expect(await (await get(bucket, ['cards', 'c-1.jpg'])).text()).toBe('card')
  })

  it('never serves masters or _meta', async () => {
    const { bucket } = await seeded(900)
    expect((await get(bucket, ['masters', `${ID}.png`])).status).toBe(404)
    expect((await get(bucket, ['_meta', 'copied.json'])).status).toBe(404)
  })
})
