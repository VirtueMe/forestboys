import { describe, expect, it, vi } from 'vitest'
import { handleImageMaker, type ImagesApi } from './image-maker-handler.ts'
import { remoteImageMaker, type MakerService } from './worker-image-maker.ts'

const bytes = new Uint8Array([1, 2, 3])

/** The real handler behind the service, over a fake Images binding: what the worker does, minus Cloudflare. */
function service(info: { format: string, width?: number, height?: number } = { format: 'image/png', width: 2000, height: 1500 }) {
  const asked: number[] = []
  const images: ImagesApi = {
    info:  () => Promise.resolve(info),
    input: () => ({
      transform: t => {
        asked.push(t.width)
        return { output: () => Promise.resolve({ image: () => new Blob([`w${t.width}`]).stream() as ReadableStream<Uint8Array> }) }
      },
    }),
  }
  const fetch = vi.fn<MakerService['fetch']>((url, init) => handleImageMaker(new Request(url, init), images))
  return { svc: { fetch } satisfies MakerService, asked, fetch }
}

describe('remoteImageMaker', () => {
  it('reads the size through the worker', async () => {
    expect(await remoteImageMaker(service().svc).dimensions(bytes)).toEqual({ width: 2000, height: 1500 })
  })

  it('says why when the worker refuses an image (an SVG has no size)', async () => {
    await expect(remoteImageMaker(service({ format: 'image/svg+xml' }).svc).dimensions(bytes)).rejects.toThrow(/info answered 422: No size/)
  })

  it('makes one WebP per width, in order, one request each', async () => {
    const s = service()
    const files = await remoteImageMaker(s.svc).resize(bytes, [400, 900])
    expect(s.asked).toEqual([400, 900])
    expect(s.fetch).toHaveBeenCalledTimes(2)
    expect(files.map(f => [f.size, new TextDecoder().decode(f.bytes)])).toEqual([[400, 'w400'], [900, 'w900']])
  })

  it('stops at the first size the worker refuses', async () => {
    const svc: MakerService = { fetch: () => Promise.resolve(Response.json({ error: 'boom' }, { status: 500 })) }
    await expect(remoteImageMaker(svc).resize(bytes, [400, 900])).rejects.toThrow(/resize 400 answered 500: boom/)
  })
})
