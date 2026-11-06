import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBucket } from '~/_lib/fake-r2.ts'
import { displayKey, masterKey } from '~/_lib/images.ts'
import { handleImageMaker, type ImagesApi } from '~/_lib/image-maker-handler.ts'

vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ id: 'u', role: 'admin' })) }))
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn() }))

const { requireAdmin } = await import('~/_lib/require-admin.ts')
const { runCypher } = await import('~/_lib/neo4j.ts')
const upload = await import('./image.ts')
const images = await import('~/images/[[path]].ts')

const SLUG = 'om-oss'
const CARD = 'card:om-oss:intro'

let r2: ReturnType<typeof fakeBucket>

/** Real signatures: the door reads the type from the bytes, not from what the browser declared. */
const MAGIC: Record<string, number[]> = {
  'image/png':  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  'image/gif':  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  'image/avif': [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66],
}
const bytesOf = (type: string, size = 16, tail = 0): Uint8Array => {
  const b = new Uint8Array(Math.max(size, (MAGIC[type] ?? []).length))
  b.set(MAGIC[type] ?? [])
  b[b.length - 1] = tail
  return b
}
const file = (type: string, size = 16, tail = 0) => new File([bytesOf(type, size, tail)], 'x', { type })

/** The Images binding behind the image-maker worker, faked: a 2000 x 1500 image, one tiny WebP per width asked for. */
function fakeImages(width = 2000, height = 1500): ImagesApi & { made: number[] } {
  const made: number[] = []
  return {
    made,
    info:  () => Promise.resolve({ format: 'image/png', width, height }),
    input: () => ({
      transform: t => ({
        output: () => { made.push(t.width); return Promise.resolve({ image: () => new Blob([`w${t.width}`]).stream() as ReadableStream<Uint8Array> }) },
      }),
    }),
  }
}
let binding: ReturnType<typeof fakeImages>

/** The service binding to the worker: the worker's real handler over the fake Images binding. */
const makerService = () => ({ fetch: (url: string, init: RequestInit) => handleImageMaker(new Request(url, init), binding) })

/** POST the multipart body to the upload function; `body` null sends something that is no multipart at all. */
const post = (body: FormData | null, cardId = CARD, env: Record<string, unknown> = {}) =>
  (upload.onRequestPost as unknown as (c: never) => Promise<Response>)({
    request: new Request('https://x.example/api/admin/pages/x/cards/x/image', body
      ? { method: 'POST', body }
      : { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } }),
    env:    { SESSION_SECRET: 's', IMAGES: r2.bucket, IMAGE_MAKER: makerService(), ...env },
    params: { slug: SLUG, cardId },
  } as never)

const withFile = (f: File | string) => { const form = new FormData(); form.set('file', f); return form }

/**
 * What the graph answers. The route asks twice: does the card exist (a row with its id), then
 * set the hero url (a row with the url). `null`: there is no such card, so no row to either.
 * The url is whatever the route sent, so the answer is what the graph would hold.
 */
const cardHas = (exists: boolean) => vi.mocked(runCypher).mockImplementation((_env, _q, p) =>
  Promise.resolve(!exists ? [] : [{ id: CARD, url: (p as { url?: string } | undefined)?.url }]))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdmin).mockResolvedValue({ id: 'u', role: 'admin' } as never)
  r2 = fakeBucket()
  binding = fakeImages()
})

describe('POST /api/admin/pages/:slug/cards/:cardId/image', () => {
  it('refuses a non-admin and touches neither the bucket nor the graph', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await post(withFile(file('image/png')))).status).toBe(403)
    expect(r2.store.size).toBe(0)
    expect(runCypher).not.toHaveBeenCalled()
  })

  it('refuses a card id that does not belong to the page', async () => {
    expect((await post(withFile(file('image/png')), 'card:annen-side:intro')).status).toBe(400)
    expect(r2.store.size).toBe(0)
  })

  // The page sends encodeURIComponent(cardId), and Pages hands the param over as sent: this was a 400 for every upload.
  it('takes the card id as the page sends it, percent-encoded', async () => {
    cardHas(true)
    expect((await post(withFile(file('image/png')), encodeURIComponent(CARD))).status).toBe(200)
    expect(runCypher).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ cardId: CARD }))
  })

  it('refuses a card id that is no valid percent-encoding', async () => {
    expect((await post(withFile(file('image/png')), 'card:om-oss:%E0%A4%A')).status).toBe(400)
    expect(r2.store.size).toBe(0)
  })

  it('refuses a body that is no multipart form', async () => {
    expect((await post(null)).status).toBe(400)
    expect(r2.store.size).toBe(0)
  })

  it('refuses a form without a file, or with text where the file should be', async () => {
    expect((await post(new FormData())).status).toBe(400)
    expect((await post(withFile('not a file'))).status).toBe(400)
    expect(r2.store.size).toBe(0)
  })

  it('refuses a file over 10 MB', async () => {
    const res = await post(withFile(file('image/png', 10 * 1024 * 1024 + 1)))
    expect(res.status).toBe(413)
    expect(r2.store.size).toBe(0)
  })

  it('accepts a file of exactly 10 MB', async () => {
    cardHas(true)
    expect((await post(withFile(file('image/png', 10 * 1024 * 1024)))).status).toBe(200)
  })

  it('refuses a type that is no supported image', async () => {
    const res = await post(withFile(file('application/pdf')))
    expect(res.status).toBe(415)
    expect((await res.json<{ error: string }>()).error).toContain('application/pdf')
    expect(r2.store.size).toBe(0)
  })

  // The door reads the type from the bytes: a declared image/png that is text is no PNG, and an SVG is not accepted (it was before #410).
  it('refuses bytes that are no image whatever the browser declared, and an SVG', async () => {
    const text = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'x', { type: 'image/png' })
    expect((await post(withFile(text))).status).toBe(415)
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'x', { type: 'image/svg+xml' })
    expect((await post(withFile(svg))).status).toBe(415)
    expect(r2.store.size).toBe(0)
    expect(runCypher).not.toHaveBeenCalled()
  })

  it('refuses an empty file', async () => {
    expect((await post(withFile(new File([], 'x', { type: 'image/png' })))).status).toBe(400)
    expect(r2.store.size).toBe(0)
  })

  it('says so when the image-maker service binding is not configured, before storing anything', async () => {
    cardHas(true)
    const res = await post(withFile(file('image/png')), CARD, { IMAGE_MAKER: undefined })
    expect(res.status).toBe(503)
    expect(r2.store.size).toBe(0)
  })

  it.each([
    ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'], ['image/avif', 'avif'],
  ])('stores %s as a master .%s and two sizes under its content hash', async (type, ext) => {
    cardHas(true)
    const res = await post(withFile(file(type)))
    expect(res.status).toBe(200)
    const { url } = await res.json<{ url: string }>()
    const id = url.replace('/images/', '')
    expect(id).toMatch(/^[0-9a-f]{40}$/)
    expect([...r2.store.keys()].sort()).toEqual([displayKey(id, 400), displayKey(id, 900), masterKey(id, ext)].sort())
    expect(r2.store.get(masterKey(id, ext))?.contentType).toBe(type)
    expect(r2.store.get(displayKey(id, 400))?.contentType).toBe('image/webp')
  })

  it('keeps the upload as the master, hands /images/<id> to the graph and answers with what the graph holds', async () => {
    cardHas(true)
    const f = file('image/png', 32, 7)
    const res = await post(withFile(f))
    const { url } = await res.json<{ ok: boolean, url: string }>()
    expect(url).toMatch(/^\/images\/[0-9a-f]{40}$/)
    expect([...r2.store.get(masterKey(url.slice('/images/'.length), 'png'))!.bytes]).toEqual([...bytesOf('image/png', 32, 7)])
    expect(runCypher).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), { slug: SLUG, cardId: CARD, url })
    expect(binding.made).toEqual([400, 900])
  })

  it('does not enlarge: a 500 px image gets one size', async () => {
    cardHas(true)
    binding = fakeImages(500, 300)
    await post(withFile(file('image/png')))
    expect(binding.made).toEqual([400])
  })

  it('stores nothing new when the same file is uploaded again', async () => {
    cardHas(true)
    await post(withFile(file('image/png', 32, 1)))
    const keys = [...r2.store.keys()], puts = r2.puts.length
    await post(withFile(file('image/png', 32, 1)))
    expect([...r2.store.keys()]).toEqual(keys)
    expect(r2.puts.length).toBe(puts)
    expect(binding.made).toEqual([400, 900])   // made once, for the first
  })

  // #404: the card is looked up before anything is stored.
  it('is a 404 for a card that does not exist, and the bucket stays empty', async () => {
    cardHas(false)
    expect((await post(withFile(file('image/png')))).status).toBe(404)
    expect(r2.store.size).toBe(0)
    expect(binding.made).toEqual([])
  })

  it('is a 502 when the graph fails on the lookup, and the bucket stays empty', async () => {
    vi.mocked(runCypher).mockRejectedValue(new Error('aura down'))
    const res = await post(withFile(file('image/png')))
    expect(res.status).toBe(502)
    expect((await res.json<{ error: string }>()).error).toBe('aura down')
    expect(r2.store.size).toBe(0)
  })

  it('is a 502 when the graph fails on the save, and a retry reuses what was stored', async () => {
    vi.mocked(runCypher)
      .mockResolvedValueOnce([{ id: CARD }] as never)           // the lookup
      .mockRejectedValueOnce(new Error('aura down'))             // the save
    expect((await post(withFile(file('image/png', 32, 3)))).status).toBe(502)
    const left = [...r2.store.keys()], puts = r2.puts.length
    cardHas(true)
    expect((await post(withFile(file('image/png', 32, 3)))).status).toBe(200)
    expect([...r2.store.keys()]).toEqual(left)                   // the same objects, no second set
    expect(r2.puts.length).toBe(puts)
  })

  it('is a 502 when the image cannot be made, and says why', async () => {
    cardHas(true)
    binding.info = () => Promise.reject(new Error('9412 not an image'))
    const res = await post(withFile(file('image/png')))
    expect(res.status).toBe(502)
    expect((await res.json<{ error: string }>()).error).toContain('9412')   // the worker's reason reaches the editor
    expect(r2.store.size).toBe(0)
  })

  // Decision (#404): a replaced image stays. An id is a content hash, so the old object can be on another card.
  it('keeps the image a card had when another replaces it', async () => {
    cardHas(true)
    await post(withFile(file('image/png', 32, 1)))
    const before = [...r2.store.keys()]
    await post(withFile(file('image/jpeg', 32, 2)))
    for (const k of before) expect(r2.store.has(k)).toBe(true)
  })
})

describe('GET /images/* (the route that serves what was uploaded)', () => {
  const get = (path: string[] | string, query = '') =>
    (images.onRequestGet as unknown as (c: never) => Promise<Response>)({
      request: new Request(`https://x.example/images/${[path].flat().join('/')}${query}`),
      params: { path }, env: { IMAGES: r2.bucket },
    } as never)

  it('serves an uploaded image back by the id in its url, at the size asked for', async () => {
    cardHas(true)
    const { url } = await (await post(withFile(file('image/png')))).json<{ url: string }>()
    const id = url.slice('/images/'.length)
    const res = await get([id])
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('etag')).toBe(`"etag-${displayKey(id, 900)}"`)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('w900')
    expect(new TextDecoder().decode(await (await get([id], '?w=400')).arrayBuffer())).toBe('w400')
  })

  it('does not serve the master', async () => {
    cardHas(true)
    const { url } = await (await post(withFile(file('image/png')))).json<{ url: string }>()
    expect((await get(masterKey(url.slice('/images/'.length), 'png').split('/'))).status).toBe(404)
  })

  it('joins a path of several segments into the key', async () => {
    await r2.bucket.put('a/b/c.png', new Response('x').body, { httpMetadata: { contentType: 'image/png' } })
    expect((await get(['a', 'b', 'c.png'])).status).toBe(200)
  })

  it('is a 404 for a key that is not in the bucket', async () => {
    expect((await get(['cards', 'ghost.png'])).status).toBe(404)
  })

  it('is a 404 for an empty key', async () => {
    expect((await get([])).status).toBe(404)
  })
})
