import { describe, expect, it } from 'vitest'
import {
  contentHash, displayKey, imageUrl, isImageId, isPrivateKey, masterKey, pickSize,
  sizeCandidates, sizesToMake, sniffType, validateImage,
} from './images.ts'

const ID = 'a'.repeat(40)
const bytes = (...v: number[]) => new Uint8Array([...v, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])

describe('pickSize', () => {
  it('picks the smallest stored size that is at least w', () => {
    expect(pickSize(1)).toBe(400)
    expect(pickSize(399)).toBe(400)
    expect(pickSize(400)).toBe(400)
    expect(pickSize(401)).toBe(900)
    expect(pickSize(600)).toBe(900)
    expect(pickSize(899)).toBe(900)
    expect(pickSize(900)).toBe(900)
  })

  it('gives the largest for anything above, and for no usable w', () => {
    expect(pickSize(5000)).toBe(900)
    expect(pickSize(undefined)).toBe(900)
    expect(pickSize(null)).toBe(900)
    expect(pickSize('')).toBe(900)
    expect(pickSize('abc')).toBe(900)
    expect(pickSize(NaN)).toBe(900)
    expect(pickSize(0)).toBe(900)
    expect(pickSize(-5)).toBe(900)
    expect(pickSize(Infinity)).toBe(900)
  })

  it('reads a query string value', () => {
    expect(pickSize('400')).toBe(400)
    expect(pickSize('401')).toBe(900)
    expect(pickSize('300.5')).toBe(400)
  })
})

describe('sizeCandidates', () => {
  it('lists the picked size, then smaller, then larger', () => {
    expect(sizeCandidates(100)).toEqual([400, 900])
    expect(sizeCandidates(600)).toEqual([900, 400])
    expect(sizeCandidates(undefined)).toEqual([900, 400])
  })
})

describe('sizesToMake', () => {
  it('never enlarges', () => {
    expect(sizesToMake(4000)).toEqual([400, 900])
    expect(sizesToMake(900)).toEqual([400, 900])
    expect(sizesToMake(899)).toEqual([400])
    expect(sizesToMake(400)).toEqual([400])
  })

  it('gives a narrower image one file, under the smallest name', () => {
    expect(sizesToMake(399)).toEqual([400])
    expect(sizesToMake(50)).toEqual([400])
  })
})

describe('keys', () => {
  it('lays out masters and display files', () => {
    expect(masterKey(ID, 'png')).toBe(`masters/${ID}.png`)
    expect(masterKey(ID, 'jpg')).toBe(`masters/${ID}.jpg`)
    expect(displayKey(ID, 400)).toBe(`i/${ID}/400.webp`)
    expect(imageUrl(ID)).toBe(`/images/${ID}`)
  })

  it('keeps masters and bookkeeping private', () => {
    expect(isPrivateKey(`masters/${ID}.png`)).toBe(true)
    expect(isPrivateKey('_meta/copied.json')).toBe(true)
    expect(isPrivateKey(displayKey(ID, 900))).toBe(false)
    expect(isPrivateKey('cards/x-1.jpg')).toBe(false)
  })

  it('knows an image id', () => {
    expect(isImageId(ID)).toBe(true)
    expect(isImageId('A'.repeat(40))).toBe(false)
    expect(isImageId('cards')).toBe(false)
    expect(isImageId(`${ID}0`)).toBe(false)
  })
})

describe('sniffType', () => {
  it('recognises the accepted types by their bytes', () => {
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif')
    expect(sniffType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffType(new TextEncoder().encode('\0\0\0\x1cftypavif\0\0\0\0'))).toBe('image/avif')
  })

  it('does not accept HEIF, text or short input', () => {
    expect(sniffType(new TextEncoder().encode('\0\0\0\x1cftypheic\0\0\0\0'))).toBeNull()
    expect(sniffType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffType(new Uint8Array([0xff]))).toBeNull()
  })
})

describe('validateImage', () => {
  const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

  it('accepts a supported type within the limit', () => {
    expect(validateImage(png, { maxBytes: 1000 })).toEqual({ ok: true, type: 'image/png' })
  })

  it('refuses empty, too large and the wrong type', () => {
    expect(validateImage(new Uint8Array(), { maxBytes: 1000 })).toEqual({ ok: false, reason: 'empty' })
    expect(validateImage(png, { maxBytes: 5 })).toEqual({ ok: false, reason: 'too-large' })
    expect(validateImage(new TextEncoder().encode('hello world, not an image'), { maxBytes: 1000 }))
      .toEqual({ ok: false, reason: 'unsupported-type' })
  })
})

describe('contentHash', () => {
  it('is the hex sha1', async () => {
    expect(await contentHash(new TextEncoder().encode('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })
})
