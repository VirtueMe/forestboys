/** An R2 bucket in memory for tests: get / put (with the conditionals the indexes and events use) / list / delete. */

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
    put: (key: string, value: string, opts?: Put) => {
      const o = store.get(key)
      if (opts?.onlyIf?.etagDoesNotMatch === '*' && o) return Promise.resolve(null)
      if (opts?.onlyIf?.etagMatches && o && `${o.etag}` !== opts.onlyIf.etagMatches) return Promise.resolve(null)
      store.set(key, { body: value, etag: (o?.etag ?? 0) + 1, meta: opts?.customMetadata })
      return Promise.resolve({})
    },
    list: ({ prefix = '' }: { prefix?: string; cursor?: string } = {}) =>
      Promise.resolve({ objects: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(key => ({ key, customMetadata: store.get(key)!.meta })), truncated: false }),
    delete: (keys: string | string[]) => { for (const k of [keys].flat()) store.delete(k); return Promise.resolve() },
  }
}
