/**
 * The copied-list (#409, epic #405): `_meta/copied.json` in the IMAGES bucket, a map from a
 * Sanity image key (`<hash>-<WxH>.<ext>`) to when it was copied. A sync or backfill reads it
 * once to know what is already copied, without listing the bucket per image.
 *
 * Writes are guarded by the etag of the read, so a local backfill and the nightly sync can
 * overlap: a refused write re-reads, merges and writes again. The file is not served by
 * `/images/*` (META_PREFIX). If it is lost or corrupt, `rebuildManifest` recreates it from one
 * listing of the bucket.
 *
 * The bucket is reached through a `ManifestStore`: the Worker binding (`bucketManifestStore`
 * here) or the S3 API from scripts (`scripts/lib/s3-bucket.ts`). The logic is the same.
 */
import { META_PREFIX, MASTERS_PREFIX } from './images.ts'

export const MANIFEST_KEY = `${META_PREFIX}copied.json`

/** The key of the custom metadata on a master that holds the Sanity key it was copied from. */
export const SANITY_KEY_META = 'sanitykey'

export interface ManifestStore {
  /** The file as stored, with its etag; null when there is none. */
  read(): Promise<{ text: string, etag: string } | null>
  /** Write when the stored etag is still `etag` (null: only when no file exists). Returns the new etag, or null when refused. */
  write(text: string, etag: string | null): Promise<string | null>
}

export class ManifestCorrupt extends Error {
  readonly etag: string
  constructor(etag: string) {
    super('the copied-list is not valid; rebuild it from the bucket')
    this.etag = etag
  }
}

/** Sanity key -> ISO time it was copied. */
export type CopiedMap = Record<string, string>

function parse(text: string, etag: string): CopiedMap {
  try {
    const v = JSON.parse(text) as { version?: unknown, copied?: unknown }
    if (v.version === 1 && v.copied && typeof v.copied === 'object' && !Array.isArray(v.copied)) {
      return v.copied as CopiedMap
    }
  } catch { /* falls through */ }
  throw new ManifestCorrupt(etag)
}

const serialize = (copied: CopiedMap) => JSON.stringify({ version: 1, copied })

export interface OpenOptions {
  /** Write to the bucket after this many new entries. Default 100: a crash loses fewer than that. */
  checkpointEvery?: number
  /** Conditional-put attempts before giving up. Default 8. */
  maxAttempts?:     number
  now?:             () => string
}

export interface Manifest {
  has(key: string): boolean
  size(): number
  /** Note that `key` is copied. Call it only after its upload succeeded. Writes at every checkpoint. */
  record(key: string): Promise<void>
  /** Write what is not yet written. Call it at the end of a run. */
  flush(): Promise<void>
  /** Entries not yet written. */
  pending(): number
}

export async function openManifest(store: ManifestStore, opts: OpenOptions = {}): Promise<Manifest> {
  const every = opts.checkpointEvery ?? 100
  const attempts = opts.maxAttempts ?? 8
  const now = opts.now ?? (() => new Date().toISOString())

  const first = await store.read()
  let etag = first?.etag ?? null
  const copied: CopiedMap = first ? parse(first.text, first.etag) : {}
  const pending = new Set<string>()

  async function flush(): Promise<void> {
    if (!pending.size) return
    for (let i = 0; i < attempts; i++) {
      const next = await store.write(serialize(copied), etag)
      if (next) {
        etag = next
        pending.clear()
        return
      }
      // Refused: someone else wrote. Take their entries, keep ours, try again.
      const theirs = await store.read()
      etag = theirs?.etag ?? null
      if (theirs) {
        const remote = parse(theirs.text, theirs.etag)
        for (const [k, t] of Object.entries(remote)) copied[k] = t
      }
    }
    throw new Error(`the copied-list could not be written after ${attempts} attempts`)
  }

  return {
    has:     key => key in copied,
    size:    () => Object.keys(copied).length,
    pending: () => pending.size,
    flush,
    async record(key) {
      if (key in copied) return
      copied[key] = now()
      pending.add(key)
      if (pending.size >= every) await flush()
    },
  }
}

/** One master as a bucket listing shows it. */
export interface MasterListing {
  key:       string
  /** Custom metadata of the object. */
  metadata?: Record<string, string>
  uploaded?: Date
}

/**
 * Recreate the list from a full listing of the masters. A master exists only once its image is
 * complete, and carries the Sanity key it was copied from; masters without one (the editors'
 * uploads) are not Sanity images and stay out. Entries already in a readable file are kept.
 */
export async function rebuildManifest(store: ManifestStore, masters: AsyncIterable<MasterListing> | Iterable<MasterListing>, opts: Pick<OpenOptions, 'maxAttempts' | 'now'> = {}): Promise<number> {
  const now = opts.now ?? (() => new Date().toISOString())
  const found: CopiedMap = {}
  for await (const m of masters) {
    if (!m.key.startsWith(MASTERS_PREFIX)) continue
    const sanityKey = m.metadata?.[SANITY_KEY_META]
    if (sanityKey) found[sanityKey] = (m.uploaded ?? new Date(now())).toISOString()
  }

  const attempts = opts.maxAttempts ?? 8
  let cur = await store.read()
  for (let i = 0; i < attempts; i++) {
    let keep: CopiedMap = {}
    if (cur) {
      try { keep = parse(cur.text, cur.etag) } catch { keep = {} }
    }
    const merged = { ...found, ...keep }
    if (await store.write(serialize(merged), cur?.etag ?? null)) return Object.keys(merged).length
    cur = await store.read()
  }
  throw new Error(`the copied-list could not be rebuilt after ${attempts} attempts`)
}

/** R2's `httpEtag` is the quoted form; the conditional put's `etagMatches` rejects the quotes. */
const unquote = (etag: string) => etag.replace(/^W\//, '').replace(/^"|"$/g, '')

/**
 * The part of an R2 bucket binding the copied-list uses, written out so scripts, which do not
 * load the Workers types, can import this file too.
 */
export interface ManifestBucket {
  get(key: string): Promise<{ text(): Promise<string>, httpEtag: string } | null>
  put(key: string, value: string, opts: {
    httpMetadata: { contentType: string }
    onlyIf:       { etagMatches: string } | { etagDoesNotMatch: string }
  }): Promise<{ httpEtag: string } | null>
}

export interface ListableBucket {
  list(opts: { prefix: string, cursor?: string, include: ['customMetadata'] }): Promise<{
    objects:   { key: string, customMetadata?: Record<string, string>, uploaded: Date }[]
    truncated: boolean
    cursor?:   string
  }>
}

/** The store over the Worker's bucket binding. */
export function bucketManifestStore(bucket: ManifestBucket, key = MANIFEST_KEY): ManifestStore {
  return {
    async read() {
      const o = await bucket.get(key)
      return o ? { text: await o.text(), etag: o.httpEtag } : null
    },
    async write(text, etag) {
      const r = await bucket.put(key, text, {
        httpMetadata: { contentType: 'application/json' },
        onlyIf:       etag ? { etagMatches: unquote(etag) } : { etagDoesNotMatch: '*' },
      })
      return r ? r.httpEtag : null
    },
  }
}

/** The masters of the bucket, through the binding, with their custom metadata. */
export async function* listMasters(bucket: ListableBucket): AsyncGenerator<MasterListing> {
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: MASTERS_PREFIX, cursor, include: ['customMetadata'] })
    for (const o of page.objects) yield { key: o.key, metadata: o.customMetadata, uploaded: o.uploaded }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}
