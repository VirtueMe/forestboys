/**
 * The shared part of storing and serving a photo (#408, epic #405): the key layout, the size
 * rule and the validation. Pure, so the scripts (backfill, sync) and the functions (uploads)
 * and the `/images/*` route all agree.
 *
 * Per image id: one master, never served (`masters/<id>.<ext>`), and up to two display files
 * (`i/<id>/400.webp`, `i/<id>/900.webp`). `Source.url` is `/images/<id>`.
 */

/** The stored display widths, ascending. A third, larger one can be added without changing a url. */
export const DISPLAY_SIZES = [400, 900] as const
export type DisplaySize = (typeof DISPLAY_SIZES)[number]

const SMALLEST = DISPLAY_SIZES[0]
const LARGEST = DISPLAY_SIZES[DISPLAY_SIZES.length - 1]

export const MASTERS_PREFIX = 'masters/'
export const META_PREFIX = '_meta/'
export const MANIFEST_KEY = `${META_PREFIX}copied.json`

/** Types the door accepts. HEIF is accepted by the caller only after conversion. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const
export type AcceptedType = (typeof ACCEPTED_TYPES)[number]

const EXTENSIONS: Record<AcceptedType, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
  'image/avif': 'avif',
}

/** An image id is a lowercase hex content hash (the Sanity sha1 for copied images, 40 chars). */
const ID_RE = /^[0-9a-f]{40}$/

export function isImageId(s: string): boolean {
  return ID_RE.test(s)
}

/**
 * The stored size a request for `w` pixels gets: the smallest stored size that is at least `w`,
 * else the largest. No usable `w` (missing, not a number, zero or negative) gets the largest.
 * Any other parameter is ignored; there is no resizing at request time.
 */
export function pickSize(w: unknown): DisplaySize {
  const n = typeof w === 'number' ? w : typeof w === 'string' && w.trim() !== '' ? Number(w) : NaN
  if (!Number.isFinite(n) || n <= 0) return LARGEST
  return DISPLAY_SIZES.find(s => s >= n) ?? LARGEST
}

/**
 * The sizes to try for a request, best first: the picked size, then smaller ones (largest of
 * them first), then larger ones. An image narrower than a size has no file for it, so the
 * route walks this list until it finds one.
 */
export function sizeCandidates(w: unknown): DisplaySize[] {
  const picked = pickSize(w)
  const smaller = DISPLAY_SIZES.filter(s => s < picked).reverse()
  const larger = DISPLAY_SIZES.filter(s => s > picked)
  return [picked, ...smaller, ...larger]
}

/**
 * The widths to make for an image `width` px wide. Never enlarged: only sizes up to the image's
 * own width. An image narrower than the smallest size gets one file, at its own width, under
 * the smallest size's name, so every image has something to serve.
 */
export function sizesToMake(width: number): DisplaySize[] {
  const fits = DISPLAY_SIZES.filter(s => s <= width)
  return fits.length ? fits : [SMALLEST]
}

export function extensionOf(type: AcceptedType): string {
  return EXTENSIONS[type]
}

/** The master's key. `ext` is the master's own file type: `jxl` when a script made a JPEG XL, else the original's. */
export function masterKey(id: string, ext: string): string {
  return `${MASTERS_PREFIX}${id}.${ext}`
}

export function displayKey(id: string, size: DisplaySize): string {
  return `i/${id}/${size}.webp`
}

export function imageUrl(id: string): string {
  return `/images/${id}`
}

/** A key the public route must never serve: masters and bookkeeping. */
export function isPrivateKey(key: string): boolean {
  return key.startsWith(MASTERS_PREFIX) || key.startsWith(META_PREFIX)
}

/** What a caller passes to the door, besides the bytes. Licence and attribution stay with the Source node. */
export interface ImageCheck {
  /** Largest file the caller accepts, in bytes. The backfill brings 40 MB; the editors' upload is lower. */
  maxBytes: number
}

export type ImageRefusal = 'empty' | 'too-large' | 'unsupported-type'

/** Sniff the type from the bytes: the declared content type is not trusted. */
export function sniffType(b: Uint8Array): AcceptedType | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  // ISO-BMFF: "ftyp" at 4, brand at 8. avif/avis is AVIF; heic/mif1 etc. are HEIF and are not accepted here.
  if (at(4, 0x66, 0x74, 0x79, 0x70) && b.length >= 12) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  return null
}

export function validateImage(bytes: Uint8Array, check: ImageCheck):
  { ok: true, type: AcceptedType } | { ok: false, reason: ImageRefusal } {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > check.maxBytes) return { ok: false, reason: 'too-large' }
  const type = sniffType(bytes)
  if (!type) return { ok: false, reason: 'unsupported-type' }
  return { ok: true, type }
}

/** Hex SHA-1 of the bytes: the id of an image that did not come from Sanity. */
export async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
}
