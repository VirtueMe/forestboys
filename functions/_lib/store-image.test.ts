import { describe, expect, it, vi, type Mock } from 'vitest'
import { fakeBucket } from './fake-r2.ts'
import { displayKey } from './images.ts'
import { ImageRefused, storeImage, type ImageMaker } from './store-image.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function maker(width: number, height = 300): ImageMaker & { resize: Mock<ImageMaker['resize']> } {
  return {
    dimensions: () => Promise.resolve({ width, height }),
    resize:     vi.fn<ImageMaker['resize']>((_b, widths) =>
      Promise.resolve(widths.map(size => ({ size, bytes: new TextEncoder().encode(`w${size}`) })))),
  }
}

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b)

describe('storeImage', () => {
  it('stores the master and both sizes, and returns what a Source needs', async () => {
    const { bucket, store } = fakeBucket()
    const r = await storeImage(bucket, PNG, { maxBytes: 100, maker: maker(2000, 1500) })
    expect(r).toMatchObject({ url: `/images/${r.id}`, hash: r.id, width: 2000, height: 1500, sizes: [400, 900], existed: false })
    expect([...store.keys()].sort()).toEqual([displayKey(r.id, 400), displayKey(r.id, 900), `masters/${r.id}.png`].sort())
    expect(store.get(displayKey(r.id, 900))?.contentType).toBe('image/webp')
    expect(store.get(`masters/${r.id}.png`)?.bytes).toEqual(PNG)
  })

  it('same bytes twice gives one set of objects and no second write', async () => {
    const { bucket, store, puts } = fakeBucket()
    const m = maker(2000)
    const a = await storeImage(bucket, PNG, { maxBytes: 100, maker: m })
    const writes = puts.length
    const b = await storeImage(bucket, PNG, { maxBytes: 100, maker: m })
    expect(b).toMatchObject({ id: a.id, width: 2000, height: 300, existed: true })
    expect(puts.length).toBe(writes)
    expect(store.size).toBe(3)
    expect(m.resize.mock.calls.length).toBe(1)
  })

  it('never enlarges: a 500 px image gets only the 400 file', async () => {
    const { bucket, store } = fakeBucket()
    const r = await storeImage(bucket, PNG, { maxBytes: 100, maker: maker(500) })
    expect(r.sizes).toEqual([400])
    expect(store.has(displayKey(r.id, 900))).toBe(false)
  })

  it('refuses a wrong type, an empty file and one over the limit, writing nothing', async () => {
    const { bucket, store } = fakeBucket()
    const m = maker(2000)
    const text8 = new TextEncoder().encode('not an image at all')
    await expect(storeImage(bucket, text8, { maxBytes: 100, maker: m })).rejects.toMatchObject({ reason: 'unsupported-type' })
    await expect(storeImage(bucket, new Uint8Array(), { maxBytes: 100, maker: m })).rejects.toBeInstanceOf(ImageRefused)
    await expect(storeImage(bucket, PNG, { maxBytes: 5, maker: m })).rejects.toMatchObject({ reason: 'too-large' })
    expect(store.size).toBe(0)
  })

  it('writes nothing public if making the sizes fails', async () => {
    const { bucket, store } = fakeBucket()
    const m = maker(2000)
    m.resize.mockRejectedValue(new Error('boom'))
    await expect(storeImage(bucket, PNG, { maxBytes: 100, maker: m })).rejects.toThrow('boom')
    expect(store.size).toBe(0)
  })

  it('uses a given id and master, and records the id, also on a repeat', async () => {
    const { bucket, store } = fakeBucket()
    const id = 'd'.repeat(40)
    const record = vi.fn(() => Promise.resolve())
    const master = { bytes: new Uint8Array([9, 9]), ext: 'jxl', contentType: 'image/jxl' }
    const r = await storeImage(bucket, PNG, { maxBytes: 100, maker: maker(1000), id, master, record })
    expect(r.id).toBe(id)
    expect(store.get(`masters/${id}.jxl`)?.bytes).toEqual(new Uint8Array([9, 9]))
    expect(store.get(`masters/${id}.jxl`)?.contentType).toBe('image/jxl')
    expect(text(store.get(displayKey(id, 400))?.bytes)).toBe('w400')
    await storeImage(bucket, PNG, { maxBytes: 100, maker: maker(1000), id, master, record })
    expect(record).toHaveBeenCalledTimes(2)
    expect(record).toHaveBeenCalledWith(id)
  })
})
