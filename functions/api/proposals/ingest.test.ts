import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only the module that talks to Neo4j is replaced: what ingest asks of the graph is what is checked (#176).
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn() }))

const { runCypher } = await import('~/_lib/neo4j.ts')
const { onRequestPost } = await import('./ingest.ts')

const cypher = vi.mocked(runCypher)
const SECRET = 'test-secret'

/** An R2 bucket in memory: enough of get / put (with the conditional the indexes use) / delete for ingest. */
function fakeBucket() {
  const store = new Map<string, string>()
  return {
    store,
    get: (key: string) => Promise.resolve(store.has(key)
      ? { httpEtag: `"${store.get(key)!.length}"`, json: () => Promise.resolve(JSON.parse(store.get(key)!)) }
      : null),
    put: (key: string, value: string, opts?: { onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string } }) => {
      if (opts?.onlyIf?.etagDoesNotMatch === '*' && store.has(key)) return Promise.resolve(null)
      store.set(key, value)
      return Promise.resolve({})
    },
    delete: (key: string) => { store.delete(key); return Promise.resolve() },
  }
}

const NOW = '2026-10-08T05:00:00.000Z'
const bundle = (targets: string[]) => ({
  bundleId: `bundle:some-outline:${NOW}`, outlineId: 'some-outline', outlineRev: 'a'.repeat(64),
  summary: 'x', createdAt: NOW, model: 'none', promptHash: 'none',
  entities: [{
    entityId: 'Unit:some-unit',
    ops: [{ op: 'create-entity', kind: 'Unit', slug: 'some-unit', props: {}, edges: targets.map(to => ({ type: 'REFERENCED_IN', to })), descriptions: [] }],
    derivedFrom: { outlineId: 'some-outline', outlineRev: 'a'.repeat(64) }, source: 's', generatedAt: NOW,
  }],
})

async function send(body: unknown, bucket = fakeBucket()) {
  const raw = JSON.stringify(body)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))].map(b => b.toString(16).padStart(2, '0')).join('')
  const request = new Request('https://site.example/api/proposals/ingest', { method: 'POST', headers: { 'X-Hub-Signature-256': `sha256=${sig}` }, body: raw })
  const env = { PROPOSALS: bucket, BOT_INGEST_SECRET: SECRET, NEO4J_URI: 'neo4j+s://abc123.databases.neo4j.io', NEO4J_USERNAME: 'u', NEO4J_PASSWORD: 'p' }
  const response = await onRequestPost({ request, env } as never)
  const json = await response.clone().json<Record<string, unknown>>()
  return { response, bucket, json }
}

const manifestOf = (bucket: ReturnType<typeof fakeBucket>) =>
  JSON.parse(bucket.store.get(`proposals/bundles/bundle:some-outline:${NOW}/manifest.json`)!) as { status?: string; unresolvedRefs?: string[] }

beforeEach(() => { cypher.mockReset() })

describe('ingest: edge targets', () => {
  it('asks the graph through the shared helper, read-only, and leaves a bundle whose targets exist pending', async () => {
    cypher.mockResolvedValue([{ key: 'soe' }] as never)
    const { response, bucket, json } = await send(bundle(['Organization:soe']))
    expect(response.status).toBe(200)
    expect(json.status).toBe('pending')
    expect(manifestOf(bucket).status).toBeUndefined()
    const [, statement, params, mode] = cypher.mock.calls[0]
    expect(statement).toMatch(/MATCH \(n:`Organization`\) WHERE n\.slug IN \$keys/)
    expect(params).toEqual({ keys: ['soe'] })
    expect(mode).toBe('Read')
  })

  it('looks a Source up by its id', async () => {
    cypher.mockResolvedValue([{ key: 'granlund-rapport-1942' }] as never)
    await send(bundle(['Source:granlund-rapport-1942']))
    expect(String(cypher.mock.calls[0][1])).toMatch(/n\.id IN \$keys/)
  })

  it('blocks a bundle whose target is not in the graph, and says which', async () => {
    cypher.mockResolvedValue([] as never)
    const { response, bucket, json } = await send(bundle(['Organization:soe']))
    expect(response.status).toBe(200)
    expect(json.status).toBe('blocked')
    expect(json.unresolvedRefs).toEqual(['Organization:soe'])
    expect(manifestOf(bucket)).toMatchObject({ status: 'blocked', unresolvedRefs: ['Organization:soe'] })
  })

  it('asks nothing when the bundle has no edges', async () => {
    const { json } = await send(bundle([]))
    expect(json.status).toBe('pending')
    expect(cypher).not.toHaveBeenCalled()
  })

  it('fails with a 502 and stores nothing when the graph cannot be asked, instead of calling every target unresolved', async () => {
    cypher.mockRejectedValue(new Error('Neo4j 403'))
    const { response, bucket, json } = await send(bundle(['Organization:soe']))
    expect(response.status).toBe(502)
    expect(json.error).toBe('Neo4j 403')
    expect(bucket.store.size).toBe(0)
  })
})

describe('ingest: the bundle\'s event log (#190)', () => {
  const eventsOf = (bucket: ReturnType<typeof fakeBucket>) =>
    [...bucket.store.entries()].filter(([k]) => k.includes('/events/')).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => JSON.parse(v) as Record<string, unknown>)

  it('writes a received event, with the channel as the actor and not a person', async () => {
    cypher.mockResolvedValue([{ key: 'soe' }] as never)
    const { bucket } = await send(bundle(['Organization:soe']))
    expect(eventsOf(bucket)).toMatchObject([{ kind: 'received', entities: 1, status: 'pending', actor: { channel: 'bot' } }])
  })

  it('says what a blocked bundle waits for', async () => {
    cypher.mockResolvedValue([] as never)
    const { bucket } = await send(bundle(['Organization:soe']))
    expect(eventsOf(bucket)).toMatchObject([{ kind: 'received', status: 'blocked', unresolvedRefs: ['Organization:soe'] }])
  })

  it('writes a resent event with the statuses it replaced, and keeps the earlier one', async () => {
    cypher.mockResolvedValue([{ key: 'soe' }] as never)
    const first = await send(bundle(['Organization:soe']))
    const mKey = `proposals/bundles/bundle:some-outline:${NOW}/manifest.json`
    const m = JSON.parse(first.bucket.store.get(mKey)!) as { entities: { status: string }[] }
    m.entities[0].status = 'accepted'
    first.bucket.store.set(mKey, JSON.stringify(m))
    await send(bundle(['Organization:soe']), first.bucket)
    expect(eventsOf(first.bucket).map(e => e.kind)).toEqual(['received', 'resent'])
    expect(eventsOf(first.bucket)[1]).toMatchObject({ replaced: { accepted: 1, pending: 0 }, actor: { channel: 'bot' } })
  })
})
