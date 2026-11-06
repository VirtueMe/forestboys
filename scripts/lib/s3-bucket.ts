/**
 * The IMAGES bucket from a script, over R2's S3 API (#409). The Worker uses the binding; a
 * script has no binding, so it signs plain `fetch` calls (SigV4) with the R2_* credentials.
 * It gives the copied-list a `ManifestStore` and the rebuild its listing of masters.
 */
import { createHash, createHmac } from 'node:crypto'
import {
  MANIFEST_KEY, SANITY_KEY_META, type ManifestStore, type MasterListing,
} from '../../functions/_lib/image-manifest.ts'
import { MASTERS_PREFIX } from '../../functions/_lib/images.ts'
import type { ImageBucket } from '../../functions/_lib/store-image.ts'

export interface S3Config {
  accountId:       string
  accessKeyId:     string
  secretAccessKey: string
  bucket:          string
}

/** R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_IMAGES_BUCKET. */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  const need = (k: string) => {
    const v = env[k]
    if (!v) throw new Error(`${k} is not set (the S3 credentials of the IMAGES bucket, see scripts/README.md)`)
    return v
  }
  return {
    accountId:       need('R2_ACCOUNT_ID'),
    accessKeyId:     need('R2_ACCESS_KEY_ID'),
    secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
    bucket:          need('R2_IMAGES_BUCKET'),
  }
}

const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex')
const hmac = (key: string | Buffer, s: string) => createHmac('sha256', key).update(s).digest()
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** R2 sometimes returns an etag as a weak validator (`W/"abc"`), e.g. on the read after a refused write; `If-Match` only accepts the strong form. */
const strong = (etag: string | null) => (etag ?? '').replace(/^W\//, '')

export const EMPTY_SHA256 = sha256('')

/** Binary bodies (photos, up to 40 MB) are sent unsigned-payload: over HTTPS R2 accepts it, and nothing is hashed twice. */
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

/** AWS Signature V4 for one request. `headers` must hold host, x-amz-date and x-amz-content-sha256 already. */
export function signV4(opts: {
  method: string, url: URL, headers: Record<string, string>, payloadHash: string,
  region: string, service: string, accessKeyId: string, secretAccessKey: string, amzDate: string,
}): string {
  const names = Object.keys(opts.headers).map(h => h.toLowerCase()).sort()
  const lower = Object.fromEntries(Object.entries(opts.headers).map(([k, v]) => [k.toLowerCase(), v.trim()]))
  const canonicalQuery = [...opts.url.searchParams.entries()]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('&')
  const canonical = [
    opts.method,
    opts.url.pathname.split('/').map(seg => encode(decodeURIComponent(seg))).join('/'),
    canonicalQuery,
    names.map(n => `${n}:${lower[n]}\n`).join(''),
    names.join(';'),
    opts.payloadHash,
  ].join('\n')
  const day = opts.amzDate.slice(0, 8)
  const scope = `${day}/${opts.region}/${opts.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', opts.amzDate, scope, sha256(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${opts.secretAccessKey}`, day), opts.region), opts.service), 'aws4_request')
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
}

export type Fetch = (url: string, init: { method: string, headers: Record<string, string>, body?: string | Uint8Array }) => Promise<Response>

export class S3Bucket {
  private readonly cfg:     S3Config
  private readonly doFetch: Fetch
  private readonly clock:   () => Date

  constructor(cfg: S3Config, doFetch: Fetch = fetch, clock: () => Date = () => new Date()) {
    this.cfg = cfg
    this.doFetch = doFetch
    this.clock = clock
  }

  private async call(method: string, key: string, query: Record<string, string> = {}, extra: Record<string, string> = {}, body?: string | Uint8Array): Promise<Response> {
    const host = `${this.cfg.accountId}.r2.cloudflarestorage.com`
    const url = new URL(`https://${host}/${this.cfg.bucket}/${key.split('/').map(encode).join('/')}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    const amzDate = this.clock().toISOString().replace(/[-:]|\.\d{3}/g, '')
    const payloadHash = typeof body === 'string' || body === undefined ? sha256(body ?? '') : UNSIGNED_PAYLOAD
    const headers: Record<string, string> = { ...extra, host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash }
    headers.authorization = signV4({
      method, url, headers, payloadHash, region: 'auto', service: 's3', amzDate,
      accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey,
    })
    delete headers.host // fetch sets it
    return this.doFetch(url.toString(), { method, headers, body })
  }

  /** The object's size, etag and custom metadata (names as the server returns them, lowercase); null when it does not exist. */
  async head(key: string): Promise<{ etag: string, size: number, metadata: Record<string, string> } | null> {
    const r = await this.call('HEAD', key)
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`HEAD ${key}: ${r.status}`)
    const metadata: Record<string, string> = {}
    r.headers.forEach((v, k) => { if (k.startsWith('x-amz-meta-')) metadata[k.slice('x-amz-meta-'.length)] = v })
    return { etag: r.headers.get('etag') ?? '', size: Number(r.headers.get('content-length') ?? 0), metadata }
  }

  /** Delete one object. A missing object is not an error. */
  async delete(key: string): Promise<void> {
    const r = await this.call('DELETE', key)
    if (!r.ok && r.status !== 404) throw new Error(`DELETE ${key}: ${r.status}`)
  }

  /**
   * The door's view of the bucket (`storeImage`, #408) over the S3 API, so a script writes
   * with the same key layout and write order as the Worker. Metadata names come back
   * lowercase, as `head` returns them.
   */
  imageBucket(): ImageBucket {
    return {
      head: async key => {
        const h = await this.head(key)
        return h && { customMetadata: h.metadata }
      },
      put: async (key, value, options) => {
        const meta = Object.fromEntries(Object.entries(options?.customMetadata ?? {}).map(([k, v]) => [`x-amz-meta-${k.toLowerCase()}`, v]))
        const type = options?.httpMetadata?.contentType
        const r = await this.call('PUT', key, {}, { ...(type ? { 'content-type': type } : {}), ...meta }, value)
        if (!r.ok) throw new Error(`PUT ${key}: ${r.status}`)
      },
    }
  }

  /** The copied-list over the S3 API: If-Match / If-None-Match on the PUT. */
  manifestStore(key = MANIFEST_KEY): ManifestStore {
    return {
      read: async () => {
        const r = await this.call('GET', key)
        if (r.status === 404) return null
        if (!r.ok) throw new Error(`GET ${key}: ${r.status}`)
        return { text: await r.text(), etag: strong(r.headers.get('etag')) }
      },
      write: async (text, etag) => {
        const r = await this.call('PUT', key, {}, {
          'content-type': 'application/json',
          ...(etag ? { 'if-match': etag } : { 'if-none-match': '*' }),
        }, text)
        if (r.status === 412 || r.status === 409) return null
        if (!r.ok) throw new Error(`PUT ${key}: ${r.status}`)
        return strong(r.headers.get('etag'))
      },
    }
  }

  /** Every master with its Sanity key: one listing, and one HEAD per master for the metadata the list does not carry. */
  async *listMasters(concurrency = 16): AsyncGenerator<MasterListing> {
    let token: string | undefined
    do {
      const r = await this.call('GET', '', { 'list-type': '2', prefix: MASTERS_PREFIX, ...(token ? { 'continuation-token': token } : {}) })
      if (!r.ok) throw new Error(`list ${MASTERS_PREFIX}: ${r.status}`)
      const xml = await r.text()
      const rows = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(m => ({
        key:      /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1] ?? '',
        uploaded: new Date(/<LastModified>([\s\S]*?)<\/LastModified>/.exec(m[1])?.[1] ?? 0),
      }))
      for (let i = 0; i < rows.length; i += concurrency) {
        const batch = await Promise.all(rows.slice(i, i + concurrency).map(async row => {
          const h = await this.call('HEAD', row.key)
          const v = h.headers.get(`x-amz-meta-${SANITY_KEY_META}`)
          return { key: row.key, uploaded: row.uploaded, metadata: v ? { [SANITY_KEY_META]: v } : undefined }
        }))
        yield* batch
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] : undefined
    } while (token)
  }
}
