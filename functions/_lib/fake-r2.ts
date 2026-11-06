/**
 * An in-memory stand-in for an R2 bucket, for tests of the functions that read or write one.
 * Only what the image upload, the image door and the image route use: put, get, head and the
 * object's metadata.
 */

interface Stored {
  bytes:          Uint8Array
  contentType:    string | undefined
  customMetadata: Record<string, string> | undefined
}

interface PutOpts {
  httpMetadata?:   { contentType?: string }
  customMetadata?: Record<string, string>
}

export function fakeBucket() {
  const store = new Map<string, Stored>()
  const puts: string[] = []

  const bucket = {
    async put(key: string, value: ReadableStream | ArrayBufferView, opts?: PutOpts) {
      const bytes = new Uint8Array(await new Response(value as BodyInit).arrayBuffer())
      store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType, customMetadata: opts?.customMetadata })
      puts.push(key)
    },
    head(key: string) {
      const hit = store.get(key)
      if (!hit) return Promise.resolve(null)
      return Promise.resolve({ key, size: hit.bytes.length, customMetadata: hit.customMetadata ?? {} })
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

  return { bucket: bucket as unknown as R2Bucket, store, puts }
}
