import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBucket } from '~/_lib/fake-r2.ts'

vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ id: 'u', role: 'admin' })) }))
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn() }))

const { requireAdmin } = await import('~/_lib/require-admin.ts')
const { runCypher } = await import('~/_lib/neo4j.ts')
const upload = await import('./image.ts')
const images = await import('~/images/[[path]].ts')

const SLUG = 'om-oss'
const CARD = 'card:om-oss:intro'
const NOW  = 1_700_000_000_000

let r2: ReturnType<typeof fakeBucket>

const file = (type: string, size = 4) => new File([new Uint8Array(size)], 'x', { type })

/** POST the multipart body to the upload function; `body` null sends something that is no multipart at all. */
const post = (body: FormData | null, cardId = CARD) =>
  (upload.onRequestPost as unknown as (c: never) => Promise<Response>)({
    request: new Request('https://x.example/api/admin/pages/x/cards/x/image', body
      ? { method: 'POST', body }
      : { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } }),
    env:    { SESSION_SECRET: 's', IMAGES: r2.bucket },
    params: { slug: SLUG, cardId },
  } as never)

const withFile = (f: File | string) => { const form = new FormData(); form.set('file', f); return form }

/** What the Cypher answers: the url now on the card's hero Source, or no row when the card does not exist. */
const cardHas = (url: string | null) => vi.mocked(runCypher).mockResolvedValue(url === null ? [] : [{ url }])

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(requireAdmin).mockResolvedValue({ id: 'u', role: 'admin' } as never)
  r2 = fakeBucket()
})
afterEach(() => vi.useRealTimers())

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
    cardHas('/images/x')
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
    cardHas('/images/x')
    expect((await post(withFile(file('image/png', 10 * 1024 * 1024)))).status).toBe(200)
  })

  it('refuses a type that is no supported image', async () => {
    const res = await post(withFile(file('application/pdf')))
    expect(res.status).toBe(415)
    expect((await res.json<{ error: string }>()).error).toContain('application/pdf')
    expect(r2.store.size).toBe(0)
  })

  it.each([
    ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'],
    ['image/gif', 'gif'], ['image/avif', 'avif'], ['image/svg+xml', 'svg'],
  ])('stores %s under the extension .%s', async (type, ext) => {
    cardHas('/images/x')
    expect((await post(withFile(file(type)))).status).toBe(200)
    expect([...r2.store.keys()]).toEqual([`cards/${CARD}-${NOW}.${ext}`])
    expect(r2.store.get(`cards/${CARD}-${NOW}.${ext}`)?.contentType).toBe(type)
  })

  it('stores the bytes, hands the url to the graph and answers with what the graph holds', async () => {
    const key = `cards/${CARD}-${NOW}.png`
    cardHas(`/images/${key}`)
    const res = await post(withFile(new File([new Uint8Array([1, 2, 3])], 'x', { type: 'image/png' })))
    expect(await res.json()).toEqual({ ok: true, url: `/images/${key}` })
    expect([...r2.store.get(key)!.bytes]).toEqual([1, 2, 3])
    expect(runCypher).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      slug: SLUG, cardId: CARD, url: `/images/${key}`,
    })
  })

  // Pinned as it is today: the file goes to the bucket before the graph is asked, so a failure
  // after that leaves an object nothing points to. Noted on #402 as a follow-up.
  it('is a 404 for a card that does not exist, and the file stays in the bucket', async () => {
    cardHas(null)
    expect((await post(withFile(file('image/png')))).status).toBe(404)
    expect(r2.store.size).toBe(1)
  })

  it('is a 502 when the graph fails, and the file stays in the bucket', async () => {
    vi.mocked(runCypher).mockRejectedValue(new Error('aura down'))
    const res = await post(withFile(file('image/png')))
    expect(res.status).toBe(502)
    expect((await res.json<{ error: string }>()).error).toBe('aura down')
    expect(r2.store.size).toBe(1)
  })
})

describe('GET /images/* (the route that serves what was uploaded)', () => {
  const get = (path: string[] | string) =>
    (images.onRequestGet as unknown as (c: never) => Promise<Response>)({
      params: { path }, env: { IMAGES: r2.bucket },
    } as never)

  it('serves an uploaded image back from the key it was stored under', async () => {
    cardHas(null) // the url is taken from the key below, not from the graph
    await post(withFile(new File([new Uint8Array([9, 8, 7])], 'x', { type: 'image/webp' })))
    const key = [...r2.store.keys()][0]
    const res = await get(key.split('/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('etag')).toBe(`"etag-${key}"`)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([9, 8, 7])
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
