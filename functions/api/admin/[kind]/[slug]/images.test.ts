import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBucket } from '~/_lib/fake-r2.ts'
import { handleImageMaker, type ImagesApi } from '~/_lib/image-maker-handler.ts'

vi.mock('~/_lib/require-editor.ts', () => ({ requireEditor: vi.fn(() => Promise.resolve({ id: 'u', role: 'editor' })) }))
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn() }))

const { requireEditor } = await import('~/_lib/require-editor.ts')
const { runCypher } = await import('~/_lib/neo4j.ts')
const route = await import('./images.ts')

type Img = { id: string, url: string, caption: string | null, isHero: boolean, order: number }
type Ctx = (c: never) => Promise<Response>

let r2: ReturnType<typeof fakeBucket>
let own: Img[]
let exists: boolean

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const png = (tail = 0) => { const b = new Uint8Array(16); b.set(PNG); b[15] = tail; return new File([b], 'x', { type: 'image/png' }) }

const binding: ImagesApi = {
  info:  () => Promise.resolve({ format: 'image/png', width: 2000, height: 1500 }),
  input: () => ({ transform: t => ({ output: () => Promise.resolve({ image: () => new Blob([`w${t.width}`]).stream() as ReadableStream<Uint8Array> }) }) }),
}
const makerService = () => ({ fetch: (url: string, init: RequestInit) => handleImageMaker(new Request(url, init), binding) })

/** The graph, as far as this route asks it: does the entity exist, the list, and the writes (applied to `own`). */
function graph() {
  vi.mocked(runCypher).mockImplementation((_env, q, p) => {
    const params = p as Record<string, unknown>
    if (q.includes('RETURN 1 AS n') && !q.includes('DELETE')) return Promise.resolve(exists ? [{ n: 1 }] : [])
    if (q.includes('AS isHero')) return Promise.resolve([...own].sort((a, b) => a.order - b.order))
    if (q.includes('MERGE (s:Source')) {
      const id = params.sourceId as string
      if (!own.some(i => i.id === id)) {
        own.push({ id, url: params.url as string, caption: params.caption as string | null, isHero: own.length === 0, order: own.length + 1 })
      }
      return Promise.resolve([])
    }
    if (q.includes('SET h.order')) {
      ;(params.ids as string[]).forEach((id, i) => { own.find(x => x.id === id)!.order = i + 1 })
      return Promise.resolve([])
    }
    if (q.includes('SET h.caption')) {
      for (const [id, c] of params.caps as [string, string | null][]) own.find(x => x.id === id)!.caption = c
      return Promise.resolve([])
    }
    if (q.includes('SET h.isHero')) { for (const i of own) i.isHero = i.id === params.hero; return Promise.resolve([]) }
    if (q.includes('DELETE h')) {
      const at = own.findIndex(i => i.id === params.id)
      if (at < 0) return Promise.resolve([])
      own.splice(at, 1)
      return Promise.resolve([{ n: 1 }])
    }
    throw new Error(`unexpected query: ${q}`)
  })
}

const call = (fn: unknown, init: RequestInit | undefined, params = { kind: 'person', slug: 'ola' }, env: Record<string, unknown> = {}) =>
  (fn as Ctx)({
    request: new Request('https://x.example/api/admin/person/ola/images', init),
    env:     { SESSION_SECRET: 's', IMAGES: r2.bucket, IMAGE_MAKER: makerService(), ...env },
    params,
  } as never)

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const upload = (f: File, extra: Record<string, string> = {}) => {
  const form = new FormData(); form.set('file', f)
  for (const [k, v] of Object.entries(extra)) form.set(k, v)
  return call(route.onRequestPost, { method: 'POST', body: form })
}
const ids = (body: { images: Img[] }) => body.images.map(i => i.id)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireEditor).mockResolvedValue({ id: 'u', role: 'editor' } as never)
  r2 = fakeBucket()
  own = []
  exists = true
  graph()
})

describe('/api/admin/<kind>/<slug>/images (#414)', () => {
  it('refuses someone who is not an editor, and touches nothing', async () => {
    vi.mocked(requireEditor).mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await upload(png())).status).toBe(403)
    expect((await call(route.onRequestGet, undefined)).status).toBe(403)
    expect(r2.store.size).toBe(0)
    expect(runCypher).not.toHaveBeenCalled()
  })

  it('is a 404 for a kind it does not know, and a 400 for a slug that is no slug', async () => {
    expect((await call(route.onRequestGet, undefined, { kind: 'page', slug: 'ola' })).status).toBe(404)
    expect((await call(route.onRequestGet, undefined, { kind: 'person', slug: 'a`) DETACH DELETE (x' })).status).toBe(400)
    expect(runCypher).not.toHaveBeenCalled()
  })

  it('stores an upload through the door and links it; the first photo is the hero', async () => {
    const res = await upload(png(1), { caption: ' Ola i 1944 ' })
    expect(res.status).toBe(200)
    const body = await res.json<{ images: Img[] }>()
    expect(body.images).toHaveLength(1)
    expect(body.images[0]).toMatchObject({ url: expect.stringMatching(/^\/images\/[0-9a-f]{40}$/), caption: 'Ola i 1944', isHero: true, order: 1 })
    expect(body.images[0].id).toMatch(/^img:upload:[0-9a-f]{40}$/)
    expect(r2.store.size).toBe(3)   // master and two sizes
  })

  it('adds a second photo after the first, not as the hero; the same file twice is one photo', async () => {
    await upload(png(1)); await upload(png(2))
    const body = await (await upload(png(2))).json<{ images: Img[] }>()
    expect(body.images.map(i => [i.order, i.isHero])).toEqual([[1, true], [2, false]])
  })

  it('looks the entity up before it stores: a missing one is a 404 and the bucket stays empty', async () => {
    exists = false
    expect((await upload(png())).status).toBe(404)
    expect(r2.store.size).toBe(0)
  })

  it('refuses a file that is no image, and one over 10 MB, before anything is stored', async () => {
    expect((await upload(new File(['hello there, not an image'], 'x', { type: 'image/png' }))).status).toBe(415)
    expect((await upload(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'x', { type: 'image/png' }))).status).toBe(413)
    expect(r2.store.size).toBe(0)
  })

  it('refuses a licence that is no licence text', async () => {
    expect((await upload(png(), { license: 'x; DROP' })).status).toBe(400)
    expect(r2.store.size).toBe(0)
  })

  it('says so when the image-maker binding is missing', async () => {
    expect((await upload(png())).status === 200).toBe(true)  // sanity: it works with the binding
    const form = new FormData(); form.set('file', png(9))
    const res = await call(route.onRequestPost, { method: 'POST', body: form }, undefined, { IMAGE_MAKER: undefined })
    expect(res.status).toBe(503)
  })

  describe('with three photos', () => {
    let a: string, b: string, c: string
    beforeEach(async () => {
      await upload(png(1)); await upload(png(2)); await upload(png(3))
      ;[a, b, c] = own.map(i => i.id)
    })
    const patch = (body: unknown) => call(route.onRequestPatch, json('PATCH', body))

    it('reorders; a photo left out of the list keeps its place after the listed ones', async () => {
      expect(ids(await (await patch({ order: [c, a, b] })).json())).toEqual([c, a, b])
      expect(ids(await (await patch({ order: [b] })).json())).toEqual([b, c, a])
    })

    it('moves the hero, and clears it with null', async () => {
      let body = await (await patch({ hero: b })).json<{ images: Img[] }>()
      expect(body.images.filter(i => i.isHero).map(i => i.id)).toEqual([b])
      body = await (await patch({ hero: null })).json()
      expect(body.images.some(i => i.isHero)).toBe(false)
    })

    it('sets and clears captions', async () => {
      let body = await (await patch({ captions: { [a]: '  Første ', [b]: 'Andre' } })).json<{ images: Img[] }>()
      expect(body.images.map(i => i.caption)).toEqual(['Første', 'Andre', null])
      body = await (await patch({ captions: { [a]: null, [b]: '   ' } })).json()
      expect(body.images.map(i => i.caption)).toEqual([null, null, null])
    })

    it('refuses an id that is not a photo of this entity, and changes nothing', async () => {
      const res = await patch({ order: [c, 'img:upload:ghost'], captions: { [a]: 'x' } })
      expect(res.status).toBe(400)
      expect(own.map(i => i.order)).toEqual([1, 2, 3])
      expect(own[0].caption).toBeNull()
    })

    it('refuses a malformed body', async () => {
      expect((await patch({ order: 'a' })).status).toBe(400)
      expect((await patch({ order: [a, a] })).status).toBe(400)
      expect((await patch({ captions: [1] })).status).toBe(400)
      expect((await patch({ captions: { [a]: 5 } })).status).toBe(400)
      expect((await patch({ hero: 5 })).status).toBe(400)
      expect((await call(route.onRequestPatch, { method: 'PATCH', body: '{nope' })).status).toBe(400)
    })

    it('removes the edge and leaves the files', async () => {
      const files = r2.store.size
      const body = await (await call(route.onRequestDelete, json('DELETE', { id: b }))).json<{ images: Img[] }>()
      expect(ids(body)).toEqual([a, c])
      expect(r2.store.size).toBe(files)
    })

    it('is a 404 to remove a photo the entity does not have, a 400 without an id', async () => {
      expect((await call(route.onRequestDelete, json('DELETE', { id: 'img:upload:ghost' }))).status).toBe(404)
      expect((await call(route.onRequestDelete, json('DELETE', {}))).status).toBe(400)
    })
  })

  it('is a 502 with the reason when the graph fails', async () => {
    vi.mocked(runCypher).mockRejectedValue(new Error('aura down'))
    const res = await call(route.onRequestGet, undefined)
    expect(res.status).toBe(502)
    expect((await res.json<{ error: string }>()).error).toBe('aura down')
  })
})
