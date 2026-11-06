/* eslint-disable @typescript-eslint/require-await -- fakes that stand in for async I/O */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  ChecksumMismatch, copyImage, downloadOriginal, makeMaster, parseSanityUrl, pool, rewriteDescriptionLinks,
  sharpMaker, type CopyDeps, type SanityImage,
} from './image-backfill.ts'

const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex')
const H = 'b0b4d19b876581906b83408e58d984cc22e9ca6d'
const URL = `https://cdn.sanity.io/images/7r6kqtqy/production/${H}-736x1052.jpg`

function img(bytes: Uint8Array, ext = 'png'): SanityImage {
  const id = sha1(bytes)
  return { id, key: `${id}-2x2.${ext}`, project: 'p', dataset: 'd', width: 2, height: 2, ext, query: '' }
}

describe('parseSanityUrl', () => {
  it('reads id, key, size, type and query', () => {
    expect(parseSanityUrl(`${URL}?w=1280&h=720`)).toMatchObject({ id: H, key: `${H}-736x1052.jpg`, width: 736, height: 1052, ext: 'jpg', query: '?w=1280&h=720' })
  })
  it('refuses what is not a Sanity image url', () => {
    expect(parseSanityUrl('/images/' + H)).toBeNull()
    expect(parseSanityUrl('https://example.com/a.jpg')).toBeNull()
  })
})

describe('rewriteDescriptionLinks', () => {
  const text = `[{"markDefs":[{"_key":"a","_type":"link","href":"${URL}?bg=000000&w=1280&h=720&fit=fill"}],"x":"keep"}]`
  it('rewrites only the url, to the large stored size', () => {
    const r = rewriteDescriptionLinks(text, new Set([H]))
    expect(r.content).toBe(text.replace(`${URL}?bg=000000&w=1280&h=720&fit=fill`, `/images/${H}?w=900`))
    expect(r.images.map(i => i.id)).toEqual([H])
    expect(r.left).toEqual([])
  })
  it('leaves a url whose image is not in the bucket, and says so', () => {
    const r = rewriteDescriptionLinks(text, new Set())
    expect(r.content).toBe(text)
    expect(r.left.map(i => i.id)).toEqual([H])
  })
  it('rewrites every occurrence', () => {
    const two = `${text}${text}`
    expect(rewriteDescriptionLinks(two, new Set([H])).content).not.toContain('cdn.sanity.io')
  })
})

describe('downloadOriginal', () => {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const target = img(bytes)
  const fast = { token: 'secret-token', backoff: () => 0 }

  it('asks for the raw upload with the token and returns checked bytes', async () => {
    const seen: { url: string, auth: string }[] = []
    const out = await downloadOriginal(target, { ...fast, fetch: async (url, init) => { seen.push({ url, auth: init.headers.authorization }); return new Response(bytes) } })
    expect(out).toEqual(bytes)
    expect(seen[0].url).toBe(`https://cdn.sanity.io/images/p/d/${target.key}?dlRaw=true`)
    expect(seen[0].auth).toBe('Bearer secret-token')
  })
  it('refuses a download whose SHA-1 is not the id', async () => {
    await expect(downloadOriginal(target, { ...fast, fetch: async () => new Response(new Uint8Array([9])) })).rejects.toBeInstanceOf(ChecksumMismatch)
  })
  it('retries a 503, then succeeds', async () => {
    let n = 0
    const out = await downloadOriginal(target, { ...fast, fetch: async () => (++n < 3 ? new Response('', { status: 503 }) : new Response(bytes)) })
    expect(out).toEqual(bytes)
    expect(n).toBe(3)
  })
  it('does not retry a 401 and never prints the token', async () => {
    let n = 0
    const err = (await downloadOriginal(target, { ...fast, fetch: async () => { n++; return new Response('', { status: 401 }) } }).catch((e: unknown) => e)) as Error
    expect(n).toBe(1)
    expect(err.message).toContain('401')
    expect(err.message).not.toContain('secret-token')
  })
  it('gives up after the attempts', async () => {
    let n = 0
    await expect(downloadOriginal(target, { ...fast, attempts: 2, fetch: async () => { n++; throw new Error('reset') } })).rejects.toThrow('reset')
    expect(n).toBe(2)
  })
})

describe('copyImage', () => {
  async function png() {
    return new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 3, background: '#a33' } }).png().toBuffer())
  }
  function deps(over: Partial<CopyDeps> = {}) {
    const puts: string[] = []
    const copied = new Set<string>()
    const d: CopyDeps = {
      download: async () => { throw new Error('not set') },
      bucket:   { head: async () => null, put: async k => { puts.push(k) } },
      maker:    sharpMaker,
      makeMaster: async () => ({ how: 'original' }),
      manifest: { has: k => copied.has(k), record: async k => { copied.add(k) } },
      maxBytes: 50e6,
      ...over,
    }
    return { d, puts, copied }
  }

  it('stores sizes then master under the Sanity id, and records it', async () => {
    const bytes = await png()
    const target = img(bytes)
    const { d, puts, copied } = deps({ download: async () => bytes })
    const r = await copyImage(target, d)
    expect(r.status).toBe('copied')
    expect(puts.at(-1)).toBe(`masters/${target.id}.png`)
    expect(puts.some(k => k.endsWith('/400.webp'))).toBe(true)
    expect(copied.has(target.key)).toBe(true)
  })
  it('keeps a JPEG XL master under its own extension', async () => {
    const bytes = await png()
    const target = img(bytes)
    const { d, puts } = deps({ download: async () => bytes, makeMaster: async () => ({ how: 'jxl', master: { bytes: new Uint8Array(3), ext: 'jxl', contentType: 'image/jxl' } }) })
    const r = await copyImage(target, d)
    expect(puts.at(-1)).toBe(`masters/${target.id}.jxl`)
    expect(r.masterBytes).toBe(3)
  })
  it('does not fetch what the copied-list has', async () => {
    const bytes = await png()
    const target = img(bytes)
    const { d, copied } = deps()
    copied.add(target.key)
    expect((await copyImage(target, d)).status).toBe('skipped')
  })
  it('is a no-op on a repeat once the master exists, and still records', async () => {
    const bytes = await png()
    const target = img(bytes)
    const { d, puts, copied } = deps({
      download: async () => bytes,
      bucket: { head: async () => ({ customMetadata: { width: '800', height: '600' } }), put: async k => { puts.push(k) } },
    })
    const r = await copyImage(target, d)
    expect(r.status).toBe('existed')
    expect(puts).toEqual([])
    expect(copied.has(target.key)).toBe(true)
  })
  it('does not record when the upload fails', async () => {
    const bytes = await png()
    const target = img(bytes)
    const { d, copied } = deps({ download: async () => bytes, bucket: { head: async () => null, put: async () => { throw new Error('PUT 500') } } })
    await expect(copyImage(target, d)).rejects.toThrow('PUT 500')
    expect(copied.size).toBe(0)
  })
})

const hasJxl = (() => { try { execFileSync('cjxl', ['--version'], { stdio: 'ignore' }); execFileSync('djxl', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

describe.skipIf(!hasJxl)('makeMaster (cjxl/djxl installed)', () => {
  it('makes a verified lossless JPEG XL of a PNG', async () => {
    const bytes = new Uint8Array(await sharp({ create: { width: 300, height: 200, channels: 3, background: '#336699' } }).png().toBuffer())
    const r = await makeMaster(bytes, 'png')
    expect(r.how).toBe('jxl')
    expect(r.master?.ext).toBe('jxl')
  })
  it('transcodes a JPEG and has checked it rebuilds byte for byte', async () => {
    const noise = Buffer.alloc(400 * 300 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7 + (i >> 5)) & 255
    const bytes = new Uint8Array(await sharp(noise, { raw: { width: 400, height: 300, channels: 3 } }).jpeg().toBuffer())
    const r = await makeMaster(bytes, 'jpg')
    expect(r.how).toBe('jxl')
  })
  it('leaves GIF, WebP and AVIF as they are', async () => {
    expect((await makeMaster(new Uint8Array(4), 'gif')).how).toBe('original')
  })
})

describe('pool', () => {
  it('limits the concurrency and returns each outcome in order, errors included', async () => {
    let live = 0, peak = 0
    const out = await pool([1, 2, 3, 4, 5], 2, async x => {
      peak = Math.max(peak, ++live)
      await new Promise(r => setTimeout(r, 5))
      live--
      if (x === 3) throw new Error('three')
      return x * 2
    })
    expect(peak).toBe(2)
    expect(out.map(o => (o.ok ? o.value : o.error.message))).toEqual([2, 4, 'three', 8, 10])
  })
})
