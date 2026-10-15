/** An R2 bucket in memory for tests: get / head / put (with the conditionals the indexes and events use) / list / delete. */

type Put = { onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string }; customMetadata?: Record<string, string> }

export function memoryR2(initial: Record<string, unknown> = {}) {
  const store = new Map<string, { body: string; etag: number; meta?: Record<string, string> }>(
    Object.entries(initial).map(([k, v]) => [k, { body: JSON.stringify(v), etag: 1 }]),
  )
  return {
    store,
    json: (key: string) => (store.has(key) ? JSON.parse(store.get(key)!.body) as Record<string, unknown> : undefined),
    meta: (key: string) => store.get(key)?.meta,
    keys: (prefix = '') => [...store.keys()].filter(k => k.startsWith(prefix)).sort(),
    get: (key: string) => {
      const o = store.get(key)
      return Promise.resolve(o ? { httpEtag: `"${o.etag}"`, json: () => Promise.resolve(JSON.parse(o.body)) } : null)
    },
    head: (key: string) => {
      const o = store.get(key)
      return Promise.resolve(o ? { key, httpEtag: `"${o.etag}"`, customMetadata: o.meta } : null)
    },
    put: (key: string, value: string, opts?: Put) => {
      const o = store.get(key)
      if (opts?.onlyIf?.etagDoesNotMatch === '*' && o) return Promise.resolve(null)
      if (opts?.onlyIf?.etagMatches && o && `${o.etag}` !== opts.onlyIf.etagMatches) return Promise.resolve(null)
      store.set(key, { body: value, etag: (o?.etag ?? 0) + 1, meta: opts?.customMetadata })
      return Promise.resolve({})
    },
    list: ({ prefix = '', delimiter }: { prefix?: string; cursor?: string; delimiter?: string } = {}) => {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).sort()
      const delimitedPrefixes = delimiter ? [...new Set(keys.map(k => k.slice(prefix.length)).filter(r => r.includes(delimiter)).map(r => `${prefix}${r.slice(0, r.indexOf(delimiter) + 1)}`))] : []
      const objects = keys.filter(k => !delimiter || !k.slice(prefix.length).includes(delimiter)).map(key => ({ key, customMetadata: store.get(key)!.meta }))
      return Promise.resolve({ objects, delimitedPrefixes, truncated: false })
    },
    delete: (keys: string | string[]) => { for (const k of [keys].flat()) store.delete(k); return Promise.resolve() },
  }
}
