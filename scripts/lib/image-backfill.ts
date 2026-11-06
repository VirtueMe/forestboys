/**
 * The copy of one Sanity photo to our bucket (#412, epic #405): fetch the original, check it,
 * make the master, and hand it to the storage door (`functions/_lib/store-image.ts`). The
 * run over the graph is `scripts/sync/backfill-images.ts`; everything that touches the
 * network, the disk or a program is passed in or isolated here so the rules can be tested.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import type { ImageMaker, ImageBucket, StoreOptions } from '../../functions/_lib/store-image.ts'
import { storeImage } from '../../functions/_lib/store-image.ts'
import type { DisplaySize } from '../../functions/_lib/images.ts'

const run = promisify(execFile)

/** `<hash>-<W>x<H>.<ext>` on Sanity's image CDN, with or without the resizing query. */
const URL_SRC = String.raw`https://cdn\.sanity\.io/images/([a-z0-9]+)/([a-z0-9_-]+)/([0-9a-f]{40})-(\d+)x(\d+)\.([a-z0-9]+)(\?[^"'\\\s]*)?`

export interface SanityImage {
  /** The Sanity SHA-1 of the original file: our image id. */
  id:      string
  /** `<hash>-<W>x<H>.<ext>`: the key the sync compares by (`Source.sanityKey`). */
  key:     string
  project: string
  dataset: string
  width:   number
  height:  number
  ext:     string
  /** The query string with its `?`, or ''. */
  query:   string
}

export function parseSanityUrl(url: string): SanityImage | null {
  const m = new RegExp(`^${URL_SRC}$`).exec(url)
  if (!m) return null
  const [, project, dataset, id, w, h, ext, query] = m
  return { id, key: `${id}-${w}x${h}.${ext}`, project, dataset, width: Number(w), height: Number(h), ext, query: query ?? '' }
}

/** The `?w=` a «Se dokument:» link gets: the large stored size. */
export const LINK_WIDTH = 900

/**
 * Every Sanity image url in a description's stored text, and the text with those that are in
 * `available` (image ids that are in the bucket) rewritten to `/images/<id>?w=900`. Only the
 * url strings change; the rest of the text stays byte for byte. The text is portable text as
 * JSON, where these urls hold no characters JSON would escape.
 */
export function rewriteDescriptionLinks(content: string, available: ReadonlySet<string>): { content: string, images: SanityImage[], left: SanityImage[] } {
  const images: SanityImage[] = []
  const left: SanityImage[] = []
  const out = content.replace(new RegExp(URL_SRC, 'g'), url => {
    const img = parseSanityUrl(url)
    if (!img) return url
    images.push(img)
    if (!available.has(img.id)) { left.push(img); return url }
    return `/images/${img.id}?w=${LINK_WIDTH}`
  })
  return { content: out, images, left }
}

export class ChecksumMismatch extends Error {
  readonly img: SanityImage
  constructor(img: SanityImage, got: string) {
    super(`${img.key}: the download has SHA-1 ${got}, the asset id says ${img.id}`)
    this.img = img
  }
}

export type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>

export interface DownloadOptions {
  token:    string
  fetch?:   Fetch
  attempts?: number
  /** Wait before retry n (0-based), ms. */
  backoff?: (n: number) => number
}

/**
 * The original upload (`?dlRaw=true` with a read token), not the public url: that one
 * re-encodes. The SHA-1 of the bytes must equal the hash in the asset id, or the file is refused.
 * Network errors and 5xx/429 are retried; anything else fails at once. The token is never
 * put in a message.
 */
export async function downloadOriginal(img: SanityImage, opts: DownloadOptions): Promise<Uint8Array> {
  const doFetch = opts.fetch ?? ((u, i) => fetch(u, i))
  const attempts = opts.attempts ?? 4
  const backoff = opts.backoff ?? (n => 1000 * 2 ** n)
  const url = `https://cdn.sanity.io/images/${img.project}/${img.dataset}/${img.key}?dlRaw=true`
  let last: Error = new Error('no attempt')
  for (let n = 0; n < attempts; n++) {
    if (n) await new Promise(r => setTimeout(r, backoff(n - 1)))
    let r: Response
    try {
      r = await doFetch(url, { headers: { authorization: `Bearer ${opts.token}` } })
    } catch (e) {
      last = new Error(`${img.key}: ${(e as Error).message}`)
      continue
    }
    if (r.status === 429 || r.status >= 500) { last = new Error(`${img.key}: Sanity answered ${r.status}`); continue }
    if (!r.ok) throw new Error(`${img.key}: Sanity answered ${r.status}`)
    const bytes = new Uint8Array(await r.arrayBuffer())
    const sha = createHash('sha1').update(bytes).digest('hex')
    if (sha !== img.id) throw new ChecksumMismatch(img, sha)
    return bytes
  }
  throw last
}

// ---- making files ----

/** The sizes and the pixel size, with sharp. The image is turned upright first, so a photo taken sideways is measured and cut as shown. */
export const sharpMaker: ImageMaker = {
  async dimensions(bytes) {
    const m = await sharp(bytes, { limitInputPixels: false }).metadata()
    if (!m.width || !m.height) throw new Error('sharp could not read the size')
    return (m.orientation ?? 1) >= 5 ? { width: m.height, height: m.width } : { width: m.width, height: m.height }
  },
  async resize(bytes, widths: DisplaySize[]) {
    return Promise.all(widths.map(async size => ({
      size,
      bytes: new Uint8Array(await sharp(bytes, { limitInputPixels: false })
        .rotate().resize({ width: size, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()),
    })))
  },
}

export interface MasterChoice {
  /** Bytes to keep as the master. Undefined: the original, as it is. */
  master?: NonNullable<StoreOptions['master']>
  /** What happened: for the report. */
  how: 'jxl' | 'original' | 'jxl-failed'
  /** Why a JPEG XL was not kept. */
  why?: string
}

/**
 * The master (#408): PNG → lossless JPEG XL, JPEG → JPEG XL transcode (the JPEG rebuilds byte
 * for byte), the rest as they are. A JPEG XL is kept only after it has been decoded again and
 * found identical (bytes for a JPEG, pixels for a PNG); otherwise the original stays as the
 * master and the report says why.
 */
export async function makeMaster(bytes: Uint8Array, ext: string): Promise<MasterChoice> {
  const kind = ext === 'png' ? 'png' : ext === 'jpg' || ext === 'jpeg' ? 'jpg' : null
  if (!kind) return { how: 'original' }
  const dir = await mkdtemp(join(tmpdir(), 'milorg-jxl-'))
  try {
    const src = join(dir, `in.${kind}`)
    const jxl = join(dir, 'out.jxl')
    const back = join(dir, `back.${kind}`)
    await writeFile(src, bytes)
    await run('cjxl', kind === 'png' ? [src, jxl, '-d', '0', '-e', '7', '--quiet'] : [src, jxl, '--quiet'], { maxBuffer: 1 << 20 })
    await run('djxl', [jxl, back, '--quiet'], { maxBuffer: 1 << 20 })
    const rebuilt = await readFile(back)
    const same = kind === 'jpg'
      ? Buffer.compare(rebuilt, bytes) === 0
      : await samePixels(bytes, rebuilt)
    if (!same) return { how: 'jxl-failed', why: 'the decoded JPEG XL differs from the original' }
    const out = await readFile(jxl)
    return out.length < bytes.length
      ? { how: 'jxl', master: { bytes: new Uint8Array(out), ext: 'jxl', contentType: 'image/jxl' } }
      : { how: 'original', why: 'the JPEG XL is not smaller' }
  } catch (e) {
    return { how: 'jxl-failed', why: (e as Error).message.split('\n')[0] }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function samePixels(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  const read = (x: Uint8Array) => sharp(x, { limitInputPixels: false }).raw().toBuffer({ resolveWithObject: true })
  const [ra, rb] = await Promise.all([read(a), read(b)])
  return ra.info.width === rb.info.width && ra.info.height === rb.info.height
    && ra.info.channels === rb.info.channels && Buffer.compare(ra.data, rb.data) === 0
}

/** HEIF/HEIC: the door does not accept it, so the pixels go in as a lossless PNG and the original stays the master. */
export async function heifAsPng(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await sharp(bytes, { limitInputPixels: false }).rotate().png().toBuffer())
  } catch {
    const dir = await mkdtemp(join(tmpdir(), 'milorg-heif-'))
    try {
      const src = join(dir, 'in.heif')
      const out = join(dir, 'out.png')
      await writeFile(src, bytes)
      await run('magick', [src, '-auto-orient', out])
      return new Uint8Array(await readFile(out))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

const isHeif = (ext: string) => ext === 'heif' || ext === 'heic'

// ---- one image ----

export interface CopyDeps {
  download: (img: SanityImage) => Promise<Uint8Array>
  bucket:   ImageBucket
  maker:    ImageMaker
  makeMaster: typeof makeMaster
  /** The copied-list. `record` is called only after the image is stored. */
  manifest: { has(key: string): boolean, record(key: string): Promise<void> }
  maxBytes: number
}

export interface CopyResult {
  /** `skipped`: the copied-list has it, nothing fetched. `existed`: the bucket already held it. */
  status:        'copied' | 'existed' | 'skipped'
  originalBytes: number
  masterBytes:   number
  how?:          MasterChoice['how']
  why?:          string
}

export async function copyImage(img: SanityImage, d: CopyDeps): Promise<CopyResult> {
  if (d.manifest.has(img.key)) return { status: 'skipped', originalBytes: 0, masterBytes: 0 }
  const original = await d.download(img)

  const heif = isHeif(img.ext)
  const choice: MasterChoice = heif ? { how: 'original' } : await d.makeMaster(original, img.ext)
  const master = heif
    ? { bytes: original, ext: img.ext, contentType: 'image/heif' }
    : choice.master
  const stored = await storeImage(d.bucket, heif ? await heifAsPng(original) : original, {
    maxBytes:  d.maxBytes,
    maker:     d.maker,
    id:        img.id,
    sanityKey: img.key,
    ...(master ? { master } : {}),
    record:    () => d.manifest.record(img.key),
  })
  return {
    status:        stored.existed ? 'existed' : 'copied',
    originalBytes: original.length,
    masterBytes:   master ? master.bytes.length : original.length,
    how:           choice.how,
    why:           choice.why,
  }
}

/** Run `fn` over `items`, at most `n` at a time. Never throws: each item's outcome is returned. */
export async function pool<T, R>(items: readonly T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<({ ok: true, value: R } | { ok: false, error: Error })[]> {
  const out: ({ ok: true, value: R } | { ok: false, error: Error })[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      try { out[i] = { ok: true, value: await fn(items[i], i) } } catch (e) { out[i] = { ok: false, error: e as Error } }
    }
  }))
  return out
}
