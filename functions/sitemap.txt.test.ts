import { describe, expect, it } from 'vitest'
import { onRequestGet as robots } from './robots.txt.ts'
import { onRequestGet as sitemap } from './sitemap.txt.ts'

const call = (fn: unknown, url: string, env: object = {}) =>
  (fn as (c: unknown) => Promise<Response> | Response)({ request: new Request(url), env, waitUntil: () => {} })

describe('GET /robots.txt', () => {
  it('points to the sitemap on the host asked', async () => {
    const res = await call(robots, 'https://preview.example/robots.txt')
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toContain('Sitemap: https://preview.example/sitemap.txt')
  })
})

describe('GET /sitemap.txt', () => {
  it('is 503 without a list rather than a partial one', async () => {
    expect((await call(sitemap, 'https://x.test/sitemap.txt')).status).toBe(503)
  })
})
