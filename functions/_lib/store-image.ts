/**
 * storeImage: the one door every path uses to put a photo in the bucket (#408, epic #405).
 * The key layout, size rule and validation are in images.ts; this writes.
 *
 * Making the files differs by caller and is passed in as `maker`: scripts decode and resize
 * with sharp, the Worker with the Images binding. The layout is the same.
 *
 * Write order: display files first, master last, with the dimensions on the master. So a
 * master that exists means the image is complete, and a repeat is a no-op.
 */
import { SANITY_KEY_META } from './image-manifest.ts'
import {
  contentHash, displayKey, extensionOf, imageUrl, masterKey, sizesToMake, validateImage,
  type AcceptedType, type DisplaySize, type ImageRefusal,
} from './images.ts'

/**
 * The part of an R2 bucket the door uses. Structural, so the Worker's R2 binding fits as it
 * is, and a script can pass its S3 client (`S3Bucket.imageBucket()`) without the Workers types.
 */
export interface ImageBucket {
  head(key: string): Promise<{ customMetadata?: Record<string, string> } | null>
  put(key: string, value: Uint8Array, options?: {
    httpMetadata?:   { contentType?: string }
    customMetadata?: Record<string, string>
  }): Promise<unknown>
}

export interface ImageMaker {
  /** Pixel size of the image. */
  dimensions(bytes: Uint8Array): Promise<{ width: number, height: number }>
  /** WebP files at the given widths (never wider than the image). */
  resize(bytes: Uint8Array, widths: DisplaySize[]): Promise<{ size: DisplaySize, bytes: Uint8Array }[]>
}

export interface StoreOptions {
  /** Largest file accepted, in bytes. The backfill brings 40 MB; the editors' upload is lower. */
  maxBytes: number
  maker:    ImageMaker
  /** The image id. Default: the SHA-1 of `bytes`; copied Sanity images pass the Sanity sha1. */
  id?:      string
  /** The master to keep instead of the original bytes (a script's JPEG XL). */
  master?:  { bytes: Uint8Array, ext: string, contentType: string }
  /** The Sanity key (`<hash>-<WxH>.<ext>`) of a copied photo; kept on the master so the copied-list can be rebuilt from a listing (#409). */
  sanityKey?: string
  /** Called with the id once the image is stored, also on a repeat: the copied-list manifest (#409). */
  record?:  (id: string) => Promise<void>
}

export interface StoredImage {
  id:      string
  /** `/images/<id>`: what goes in `Source.url`. */
  url:     string
  hash:    string
  width:   number
  height:  number
  sizes:   DisplaySize[]
  type:    AcceptedType
  /** True when the image was already there and nothing was written. */
  existed: boolean
}

export class ImageRefused extends Error {
  readonly reason: ImageRefusal
  constructor(reason: ImageRefusal) {
    super(`image refused: ${reason}`)
    this.reason = reason
  }
}

export async function storeImage(bucket: ImageBucket, bytes: Uint8Array, opts: StoreOptions): Promise<StoredImage> {
  const checked = validateImage(bytes, { maxBytes: opts.maxBytes })
  if (!checked.ok) throw new ImageRefused(checked.reason)
  const { type } = checked

  const hash = await contentHash(bytes)
  const id = opts.id ?? hash
  const mKey = masterKey(id, opts.master?.ext ?? extensionOf(type))

  const done = async (r: Omit<StoredImage, 'id' | 'url' | 'hash' | 'type'>): Promise<StoredImage> => {
    await opts.record?.(id)
    return { id, url: imageUrl(id), hash, type, ...r }
  }

  const head = await bucket.head(mKey)
  const w = Number(head?.customMetadata?.width)
  const h = Number(head?.customMetadata?.height)
  if (head && w > 0 && h > 0) {
    return done({ width: w, height: h, sizes: sizesToMake(w), existed: true })
  }

  const { width, height } = await opts.maker.dimensions(bytes)
  const widths = sizesToMake(width)
  const files = await opts.maker.resize(bytes, widths)
  if (files.length !== widths.length) throw new Error(`image ${id}: made ${files.length} sizes, wanted ${widths.length}`)

  for (const f of files) {
    await bucket.put(displayKey(id, f.size), f.bytes, { httpMetadata: { contentType: 'image/webp' } })
  }
  await bucket.put(mKey, opts.master?.bytes ?? bytes, {
    httpMetadata:   { contentType: opts.master?.contentType ?? type },
    customMetadata: {
      width: String(width), height: String(height), hash,
      ...(opts.sanityKey ? { [SANITY_KEY_META]: opts.sanityKey } : {}),
    },
  })

  return done({ width, height, sizes: widths, existed: false })
}
