/**
 * An in-memory stand-in for an R2 bucket, for tests of the functions that read or write one.
 * Only what the image upload and the image route use: put, get and the object's metadata.
 */

interface Stored {
  bytes:       Uint8Array
  contentType: string | undefined
}

export function fakeBucket() {
  const store = new Map<string, Stored>()

  const bucket = {
    async put(key: string, value: ReadableStream, opts?: { httpMetadata?: { contentType?: string } }) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer())
      store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType })
    },
    get(key: string) {
      const hit = store.get(key)
      if (!hit) return Promise.resolve(null)
      return Promise.resolve({
        body:     new Response(hit.bytes).body,
        httpEtag: `"etag-${key}"`,
        writeHttpMetadata(headers: Headers) {
          if (hit.contentType) headers.set('content-type', hit.contentType)
        },
      })
    },
  }

  return { bucket: bucket as unknown as R2Bucket, store }
}
