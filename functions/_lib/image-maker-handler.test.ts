import { describe, expect, it, vi } from 'vitest'
import { handleImageMaker, MAX_WIDTH, type ImagesApi } from './image-maker-handler.ts'

function binding(info: { format: string, width?: number, height?: number } = { format: 'image/png', width: 2000, height: 1500 }) {
  const asked: number[] = []
  const api: ImagesApi = {
    info:  vi.fn(() => Promise.resolve(info)),
    input: () => ({
      transform: t => {
        asked.push(t.width)
        return { output: () => Promise.resolve({ image: () => new Blob([`w${t.width}`]).stream() as ReadableStream<Uint8Array> }) }
      },
    }),
  }
  return { api, asked }
}

const call = (path: string, api: ImagesApi, init: RequestInit = { method: 'POST', body: new Uint8Array([1, 2, 3]) }) =>
  handleImageMaker(new Request(`https://image-maker${path}`, init), api)

describe('handleImageMaker', () => {
  it('answers /info with the size the binding reads', async () => {
    const res = await call('/info', binding().api)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ format: 'image/png', width: 2000, height: 1500 })
  })

  it('is a 422 for an image the binding cannot size (an SVG has none), and for one it cannot read', async () => {
    expect((await call('/info', binding({ format: 'image/svg+xml' }).api)).status).toBe(422)
    const broken = binding().api
    broken.info = () => Promise.reject(new Error('9412 not an image'))
    const res = await call('/info', broken)
    expect(res.status).toBe(422)
    expect((await res.json<{ error: string }>()).error).toContain('9412')
  })

  it('makes a WebP of the width asked for, without enlarging', async () => {
    const { api, asked } = binding()
    const res = await call('/resize?width=400', api)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(await res.text()).toBe('w400')
    expect(asked).toEqual([400])
  })

  it.each(['', '?width=0', '?width=-5', '?width=abc', '?width=1.5', `?width=${MAX_WIDTH + 1}`])('refuses a resize with width %s', async q => {
    const { api, asked } = binding()
    expect((await call(`/resize${q}`, api)).status).toBe(400)
    expect(asked).toEqual([])
  })

  it('refuses an empty body, another method and another path', async () => {
    const { api } = binding()
    expect((await call('/info', api, { method: 'POST', body: new Uint8Array() })).status).toBe(400)
    expect((await call('/info', api, { method: 'GET' })).status).toBe(405)
    expect((await call('/other', api)).status).toBe(404)
  })
})
