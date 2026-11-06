import { describe, expect, it, vi } from 'vitest'
import {
  bucketManifestStore, listMasters, ManifestCorrupt, MANIFEST_KEY, openManifest, rebuildManifest,
  SANITY_KEY_META, type MasterListing,
} from './image-manifest.ts'
import { fakeBucket } from './fake-r2.ts'
import { isPrivateKey } from './images.ts'
import { memoryR2 } from './memory-r2.ts'
import { storeImage, type ImageMaker } from './store-image.ts'

const store = (r2 = memoryR2()) => ({ r2, store: bucketManifestStore(r2) })
const copied = (r2: ReturnType<typeof memoryR2>) => (r2.json(MANIFEST_KEY)?.copied ?? {}) as Record<string, string>
const keys = (r2: ReturnType<typeof memoryR2>) => Object.keys(copied(r2)).sort()

function* of(...items: MasterListing[]) { yield* items }

describe('openManifest', () => {
  it('starts empty when there is no file, and writes on flush', async () => {
    const { r2, store: s } = store()
    const m = await openManifest(s, { now: () => '2026-11-06T10:00:00.000Z' })
    expect(m.has('a-1x1.jpg')).toBe(false)
    await m.record('a-1x1.jpg')
    expect(r2.store.has(MANIFEST_KEY)).toBe(false)
    await m.flush()
    expect(copied(r2)).toEqual({ 'a-1x1.jpg': '2026-11-06T10:00:00.000Z' })
    expect(m.pending()).toBe(0)
  })

  it('knows what a file already holds, and does not list the bucket', async () => {
    const r2 = memoryR2({ [MANIFEST_KEY]: { version: 1, copied: { 'x-1x1.png': 't' } } })
    const list = vi.spyOn(r2, 'list')
    const m = await openManifest(bucketManifestStore(r2))
    expect(m.has('x-1x1.png')).toBe(true)
    await m.record('x-1x1.png')
    await m.record('y-1x1.png')
    await m.flush()
    expect(keys(r2)).toEqual(['x-1x1.png', 'y-1x1.png'])
    expect(copied(r2)['x-1x1.png']).toBe('t')
    expect(list).not.toHaveBeenCalled()
  })

  it('two overlapping runs both end up in the manifest', async () => {
    const { r2, store: s } = store()
    const a = await openManifest(s)
    const b = await openManifest(s)
    await a.record('a-1x1.jpg')
    await b.record('b-1x1.jpg')
    await a.flush()
    await b.flush() // refused once: re-reads, merges, writes again
    expect(keys(r2)).toEqual(['a-1x1.jpg', 'b-1x1.jpg'])
    await a.record('c-1x1.jpg')
    await a.flush() // a's etag is its own write, which b has since replaced
    expect(keys(r2)).toEqual(['a-1x1.jpg', 'b-1x1.jpg', 'c-1x1.jpg'])
  })

  it('a first write loses a race against a file created meanwhile', async () => {
    const { r2, store: s } = store()
    const a = await openManifest(s)
    const b = await openManifest(s)
    await a.record('a-1x1.jpg'); await a.flush()
    await b.record('b-1x1.jpg'); await b.flush()
    expect(keys(r2)).toEqual(['a-1x1.jpg', 'b-1x1.jpg'])
  })

  it('a crash after a checkpoint loses fewer than N', async () => {
    const { r2, store: s } = store()
    const m = await openManifest(s, { checkpointEvery: 3 })
    for (const k of ['1', '2', '3', '4', '5']) await m.record(`${k}-1x1.jpg`)
    // no flush: the run died here
    expect(keys(r2)).toEqual(['1-1x1.jpg', '2-1x1.jpg', '3-1x1.jpg'])
    expect(m.pending()).toBe(2)
  })

  it('gives up after maxAttempts when every write is refused', async () => {
    const s = { read: () => Promise.resolve(null), write: vi.fn(() => Promise.resolve(null)) }
    const m = await openManifest(s, { maxAttempts: 3 })
    await m.record('a-1x1.jpg')
    await expect(m.flush()).rejects.toThrow(/3 attempts/)
    expect(s.write).toHaveBeenCalledTimes(3)
  })

  it('refuses a corrupt file', async () => {
    const r2 = memoryR2()
    await r2.put(MANIFEST_KEY, 'not json')
    await expect(openManifest(bucketManifestStore(r2))).rejects.toBeInstanceOf(ManifestCorrupt)
  })
})

describe('rebuildManifest', () => {
  const master = (id: string, sanityKey?: string): MasterListing => ({
    key: `masters/${id}.jpg`, uploaded: new Date('2026-01-02T00:00:00Z'),
    metadata: sanityKey ? { [SANITY_KEY_META]: sanityKey } : undefined,
  })

  it('recreates a lost file from the masters that carry a Sanity key', async () => {
    const { r2, store: s } = store()
    const n = await rebuildManifest(s, of(master('a', 'a-10x10.jpg'), master('b'), master('c', 'c-5x5.jpg')))
    expect(n).toBe(2)
    expect(copied(r2)).toEqual({ 'a-10x10.jpg': '2026-01-02T00:00:00.000Z', 'c-5x5.jpg': '2026-01-02T00:00:00.000Z' })
  })

  it('replaces a corrupt file', async () => {
    const { r2, store: s } = store()
    await r2.put(MANIFEST_KEY, '{oops')
    await rebuildManifest(s, of(master('a', 'a-10x10.jpg')))
    expect(keys(r2)).toEqual(['a-10x10.jpg'])
  })

  it('keeps the entries a readable file already has', async () => {
    const { r2, store: s } = store(memoryR2({ [MANIFEST_KEY]: { version: 1, copied: { 'z-1x1.jpg': 'old' } } }))
    await rebuildManifest(s, of(master('a', 'a-10x10.jpg')))
    expect(keys(r2)).toEqual(['a-10x10.jpg', 'z-1x1.jpg'])
  })

  it('lists the masters through the binding, page by page', async () => {
    const r2 = memoryR2()
    await r2.put('masters/a.jpg', 'x', { customMetadata: { [SANITY_KEY_META]: 'a-1x1.jpg' } })
    await r2.put('i/a/400.webp', 'x')
    const out: MasterListing[] = []
    for await (const m of listMasters(r2)) out.push(m)
    expect(out.map(m => m.key)).toEqual(['masters/a.jpg'])
    expect(out[0].metadata).toEqual({ [SANITY_KEY_META]: 'a-1x1.jpg' })
  })
})

describe('with the storage door', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
  const maker: ImageMaker = {
    dimensions: () => Promise.resolve({ width: 500, height: 300 }),
    resize:     (_b, widths) => Promise.resolve(widths.map(size => ({ size, bytes: new Uint8Array([1]) }))),
  }

  it('an image goes in only after its upload succeeded', async () => {
    const { r2, store: s } = store()
    const m = await openManifest(s)
    const { bucket } = fakeBucket()
    const bad: ImageMaker = { ...maker, resize: () => Promise.reject(new Error('boom')) }
    await expect(storeImage(bucket, PNG, { maxBytes: 100, maker: bad, record: () => m.record('a-500x300.png') })).rejects.toThrow('boom')
    expect(m.has('a-500x300.png')).toBe(false)
    await storeImage(bucket, PNG, { maxBytes: 100, maker, sanityKey: 'a-500x300.png', record: () => m.record('a-500x300.png') })
    expect(m.has('a-500x300.png')).toBe(true)
    await m.flush()
    expect(keys(r2)).toEqual(['a-500x300.png'])
  })

  it('keeps the Sanity key on the master', async () => {
    const { bucket, store: files } = fakeBucket()
    const r = await storeImage(bucket, PNG, { maxBytes: 100, maker, sanityKey: 'a-500x300.png' })
    expect(files.get(`masters/${r.id}.png`)?.customMetadata?.[SANITY_KEY_META]).toBe('a-500x300.png')
  })

  it('is not served by the image route', () => {
    expect(isPrivateKey(MANIFEST_KEY)).toBe(true)
  })
})
