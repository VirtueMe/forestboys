import { describe, expect, it } from 'vitest'
import { EMPTY_SHA256, S3Bucket, signV4, type Fetch } from './s3-bucket.ts'

describe('signV4', () => {
  it("matches AWS's documented GET Object example", () => {
    const auth = signV4({
      method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' },
      payloadHash: EMPTY_SHA256, region: 'us-east-1', service: 's3', amzDate: '20130524T000000Z',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    })
    expect(auth).toContain('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
    expect(auth).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date')
  })
})

describe('S3Bucket manifest store', () => {
  const cfg = { accountId: 'acc', accessKeyId: 'k', secretAccessKey: 's', bucket: 'images' }
  const clock = () => new Date('2026-11-06T10:00:00Z')

  function bucket(respond: (url: string, init: Parameters<Fetch>[1]) => Response) {
    const calls: { url: string, init: Parameters<Fetch>[1] }[] = []
    const f: Fetch = (url, init) => { calls.push({ url, init }); return Promise.resolve(respond(url, init)) }
    return { s3: new S3Bucket(cfg, f, clock), calls }
  }

  it('writes with If-Match, and returns null on 412', async () => {
    const { s3, calls } = bucket(() => new Response('', { status: 412 }))
    expect(await s3.manifestStore().write('{}', '"e1"')).toBeNull()
    expect(calls[0].url).toBe('https://acc.r2.cloudflarestorage.com/images/_meta/copied.json')
    expect(calls[0].init.headers['if-match']).toBe('"e1"')
    expect(calls[0].init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=k\/20261106\/auto\/s3\/aws4_request/)
  })

  it('creates with If-None-Match: * and returns the new etag', async () => {
    const { s3, calls } = bucket(() => new Response('', { status: 200, headers: { etag: '"e2"' } }))
    expect(await s3.manifestStore().write('{}', null)).toBe('"e2"')
    expect(calls[0].init.headers['if-none-match']).toBe('*')
  })

  it('reads null on 404 and the text with its etag otherwise', async () => {
    expect(await bucket(() => new Response('', { status: 404 })).s3.manifestStore().read()).toBeNull()
    const { s3 } = bucket(() => new Response('{"a":1}', { headers: { etag: '"e3"' } }))
    expect(await s3.manifestStore().read()).toEqual({ text: '{"a":1}', etag: '"e3"' })
  })

  it('reads a weak etag as the strong one, so the retry after a refused write is accepted', async () => {
    const { s3 } = bucket(() => new Response('{}', { headers: { etag: 'W/"e5"' } }))
    expect((await s3.manifestStore().read())?.etag).toBe('"e5"')
  })

  it('lists the masters with their Sanity keys, across pages', async () => {
    const page = (keys: string[], next?: string) => `<ListBucketResult>${keys.map(k => `<Contents><Key>${k}</Key><LastModified>2026-01-02T00:00:00.000Z</LastModified></Contents>`).join('')}<IsTruncated>${!!next}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ''}</ListBucketResult>`
    const { s3, calls } = bucket((url, init) => {
      if (init.method === 'HEAD') return new Response('', { headers: url.endsWith('a.jpg') ? { 'x-amz-meta-sanitykey': 'a-1x1.jpg' } : {} })
      return new Response(url.includes('continuation-token') ? page(['masters/b.jpg']) : page(['masters/a.jpg'], 'T1'))
    })
    const out = []
    for await (const m of s3.listMasters()) out.push(m)
    expect(out.map(m => [m.key, m.metadata?.sanitykey])).toEqual([['masters/a.jpg', 'a-1x1.jpg'], ['masters/b.jpg', undefined]])
    expect(calls.filter(c => c.init.method === 'GET')).toHaveLength(2)
  })

  it('heads an object: etag, size and the custom metadata, lowercase', async () => {
    const { s3, calls } = bucket(() => new Response('', { headers: { etag: '"e4"', 'content-length': '12', 'x-amz-meta-sanitykey': 'a-1x1.jpg' } }))
    expect(await s3.head('masters/a.jpg')).toEqual({ etag: '"e4"', size: 12, metadata: { sanitykey: 'a-1x1.jpg' } })
    expect(calls[0].init.method).toBe('HEAD')
  })

  it('head is null on 404, an error otherwise', async () => {
    expect(await bucket(() => new Response('', { status: 404 })).s3.head('x')).toBeNull()
    await expect(bucket(() => new Response('', { status: 403 })).s3.head('x')).rejects.toThrow('HEAD x: 403')
  })

  it('deletes, and a missing object is fine', async () => {
    const { s3, calls } = bucket(() => new Response(null, { status: 204 }))
    await s3.delete('masters/a.jpg')
    expect(calls[0].init.method).toBe('DELETE')
    await bucket(() => new Response('', { status: 404 })).s3.delete('x')
    await expect(bucket(() => new Response('', { status: 500 })).s3.delete('x')).rejects.toThrow('DELETE x: 500')
  })

  describe('imageBucket', () => {
    it('puts binary bytes unsigned with content type and metadata headers', async () => {
      const { s3, calls } = bucket(() => new Response('', { status: 200 }))
      const bytes = new Uint8Array([1, 2, 3])
      await s3.imageBucket().put('masters/a.jxl', bytes, { httpMetadata: { contentType: 'image/jxl' }, customMetadata: { width: '10', sanitykey: 'a-1x1.png' } })
      const h = calls[0].init.headers
      expect(calls[0].init.method).toBe('PUT')
      expect(calls[0].init.body).toBe(bytes)
      expect(h['content-type']).toBe('image/jxl')
      expect(h['x-amz-meta-width']).toBe('10')
      expect(h['x-amz-meta-sanitykey']).toBe('a-1x1.png')
      expect(h['x-amz-content-sha256']).toBe('UNSIGNED-PAYLOAD')
    })

    it('throws on a refused put', async () => {
      const { s3 } = bucket(() => new Response('', { status: 403 }))
      await expect(s3.imageBucket().put('k', new Uint8Array(1))).rejects.toThrow('PUT k: 403')
    })

    it('heads to customMetadata, and null when missing', async () => {
      const { s3 } = bucket(() => new Response('', { headers: { 'x-amz-meta-width': '640', 'x-amz-meta-height': '480' } }))
      expect((await s3.imageBucket().head('masters/a.jpg'))?.customMetadata).toEqual({ width: '640', height: '480' })
      expect(await bucket(() => new Response('', { status: 404 })).s3.imageBucket().head('x')).toBeNull()
    })
  })
})
