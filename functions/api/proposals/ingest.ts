/**
 * POST /api/proposals/ingest — receive a Claude-generated bundle from the
 * bot-task GitHub Action.
 *
 * Side effects (in order):
 *   1. Verify HMAC on the raw body.
 *   2. Validate bundle shape (manifest + per-entity payloads + ops + edge
 *      target resolution).
 *   3. Compute current Neo4j SHA for every modify-block op (NOT YET — see v1
 *      limitation below).
 *   4. Write the manifest + every per-entity payload to R2.
 *   5. Patch by-entity and source (by-outline / by-source) indices with If-Match retry.
 *   6. Comment on the source GitHub issue + close it (outline bundles).
 *
 * Origin: an outline (Claude, `outlineId` + `outlineRev`) or the Sanity sync
 * (`origin: {type: 'sanity', …}`) — functions/_lib/bundle-origin.ts.
 *
 * Auth: HMAC-SHA256 on raw body, header `X-Hub-Signature-256`.
 * NOT admin-session-gated.
 *
 * v1 limitation: `expectedSha` for modify-block ops is stored as the bot
 * sent it (or empty). Drift detection at accept time will compute the live
 * Neo4j sha and compare. Once /api/entity/<kind>/<slug>/context exists and
 * the bot fetches current state before generating, expectedSha will land
 * here pre-populated.
 */

import {
  bundleChannel, isOutlineBundle, sourceIndexKey, validateDerivedFrom, validateOrigin,
  type BundleOriginFields, type DerivedFrom,
} from '~/_lib/bundle-origin.ts'
import { ENTITY_ID_RE, isNodeRef, keyProp, parseNodeRef } from '~/_lib/entity-ref.ts'

interface Env {
  PROPOSALS:         R2Bucket
  BOT_INGEST_SECRET: string
  GITHUB_TOKEN:      string
  GITHUB_REPO:       string
  ADMIN_BASE_URL?:   string  // e.g. "https://milorg.pages.dev"
  BOT_DISPATCH_URL?: string  // local-runner only — for resolve dispatch
  NEO4J_URI:         string
  NEO4J_HTTP_URI?:   string
  NEO4J_USERNAME:    string
  NEO4J_PASSWORD:    string
  BUNDLE_EVENTS?:    DurableObjectNamespace  // SSE pub-sub
}

const ENTITY_KINDS = new Set([
  'Person', 'Unit', 'Station', 'Transport',
  'Operation', 'Incident', 'Location', 'Outline', 'Organization',
])
const OP_TYPES = new Set([
  'create-entity', 'modify-block', 'add-edge', 'remove-edge',
  'delete-entity', 'obsolete-outline', 'set-props', 'set-kind',
])
const SLUG_RE        = /^[a-z0-9-]+$/
const PROP_NAME_RE   = /^[A-Za-z][A-Za-z0-9_]*$/
/** Never set through set-props: identity and provenance the sync owns. */
const PROTECTED_PROPS = new Set(['slug', 'sanityId', 'id'])
const BLOCK_PATH_RE  = /^section\.[a-z0-9-]+\.block\.[A-Za-z0-9_-]+$/
const BUNDLE_ID_RE   = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

interface BundleEntityRef {
  entityId:  string
  status:    'pending' | 'accepted' | 'denied' | 'drifted'
  opSummary: string[]
}

interface BundleManifest extends BundleOriginFields {
  bundleId:         string
  summary:          string
  createdAt:        string
  model:            string
  promptHash:       string
  entities:         BundleEntityRef[]
  /** 'blocked' = at least one edge target neither lives nor is being
   *  created in this bundle; the bundle waits for child bundles to
   *  resolve `unresolvedRefs` before Jan can review. 'pending' on a
   *  parent flips to 'closed' once every entity is non-pending. */
  status?:          'pending' | 'blocked' | 'closed'
  unresolvedRefs?:  string[]
  /** Set on a child bundle generated to resolve a parent's unresolved
   *  ref. The child manifest is otherwise identical to a parent's. */
  parentBundle?:    string
  resolvesEntities?: string[]
}

interface InitialDescription { order: number; content: string }

type BundleOp =
  | { op: 'create-entity'; kind: string; slug: string; props: Record<string, unknown>; edges?: { type: string; to: string; props?: Record<string, unknown> }[]; descriptions?: InitialDescription[] }
  | { op: 'modify-block'; blockPath: string; expectedSha: string; newValue: Record<string, unknown> }
  | { op: 'add-edge';     type: string; from: string; to: string; props?: Record<string, unknown> }
  | { op: 'remove-edge';  type: string; from: string; to: string }
  | { op: 'delete-entity' }
  | { op: 'obsolete-outline'; reason: string }
  | { op: 'set-props';        props: Record<string, { from: unknown; to: unknown }> }
  | { op: 'set-kind';         to: 'Operation' | 'Incident' }

interface EntityPayload {
  entityId:    string
  ops:         BundleOp[]
  derivedFrom: DerivedFrom
  source:      string
  generatedAt: string
}

interface IngestBody {
  bundleId:    unknown
  outlineId?:  unknown
  outlineRev?: unknown
  origin?:     unknown
  summary:     unknown
  createdAt:   unknown
  model:       unknown
  promptHash:  unknown
  entities:    unknown  // [{entityId, ops, derivedFrom, source, generatedAt}]
  issueNumber?: unknown
}

interface ValidatedBundle {
  manifest: BundleManifest
  payloads: Map<string, EntityPayload>  // keyed by entityId
  issueNumber: number | null
}

interface IndexFile {
  bundleIds: string[]
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.PROPOSALS)         return json({ error: 'PROPOSALS R2 binding missing' }, 500)
  if (!env.BOT_INGEST_SECRET) return json({ error: 'BOT_INGEST_SECRET not configured' }, 500)

  const rawBody = await request.arrayBuffer()
  const sigHeader = request.headers.get('X-Hub-Signature-256') || ''
  const ok = await verifyHmac(rawBody, sigHeader, env.BOT_INGEST_SECRET)
  if (!ok) return json({ error: 'Invalid signature' }, 401)

  let parsed: IngestBody
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBody)) as IngestBody
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const validated = validateBundle(parsed)
  if (typeof validated === 'string') return json({ error: validated }, 400)

  try {
    await writeBundle(env, validated)

    // Clear the pending-generation marker for this outline. Parents and
    // children alike count as "this outline finished a generation".
    if (isOutlineBundle(validated.manifest)) {
      await env.PROPOSALS.delete(`proposals/pending-generations/${validated.manifest.outlineId}.json`)
    }

    await broadcast(env, bundleChannel(validated.manifest), {
      kind:     'bundle-created',
      bundleId: validated.manifest.bundleId,
    })

    // Resolve unmet refs into manifest.status / unresolvedRefs.
    const refs = await resolveBundleRefs(env, validated)
    if (refs.unresolved.length) {
      validated.manifest.status         = 'blocked'
      validated.manifest.unresolvedRefs = refs.unresolved
      await env.PROPOSALS.put(
        `proposals/bundles/${validated.manifest.bundleId}/manifest.json`,
        JSON.stringify(validated.manifest),
        { httpMetadata: { contentType: 'application/json' } },
      )
      // Watcher index: each unresolved ref records who's waiting.
      for (const id of refs.unresolved) {
        await appendWatcher(env, id, validated.manifest.bundleId)
      }
      // Fire-and-forget resolve dispatches (outline bundles — the resolver
      // generates from the outline). Failure leaves the bundle blocked —
      // Jan can re-trigger from the UI later.
      if (isOutlineBundle(validated.manifest)) void dispatchResolves(env, validated.manifest, refs.unresolved).catch((e) => {
        console.error('resolve dispatch failed:', (e as Error).message)
      })
    }

    // If this is a child resolving a parent's refs, revalidate the parent.
    if (validated.manifest.parentBundle && validated.manifest.resolvesEntities?.length) {
      void revalidateParent(env, validated.manifest.parentBundle).catch((e) => {
        console.error('parent revalidate failed:', (e as Error).message)
      })
    }

    await commentAndClose(env, validated).catch((e) => {
      // Issue close failure is non-fatal — bundle is durable in R2.
      console.error('issue comment/close failed:', (e as Error).message)
    })
    return json({
      ok:             true,
      bundleId:       validated.manifest.bundleId,
      entityCount:    validated.manifest.entities.length,
      status:         validated.manifest.status ?? 'pending',
      unresolvedRefs: refs.unresolved,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function validateBundle(b: IngestBody): ValidatedBundle | string {
  if (typeof b.bundleId !== 'string' || !BUNDLE_ID_RE.test(b.bundleId)) {
    return 'bundleId must match `bundle:<channel>:<isoTimestamp>`'
  }
  const origin = validateOrigin(b as unknown as Record<string, unknown>)
  if (typeof origin === 'string') return origin
  if (!b.bundleId.startsWith(`bundle:${bundleChannel(origin)}:`)) {
    return `bundleId must start with bundle:${bundleChannel(origin)}:`
  }
  if (typeof b.summary    !== 'string' || !b.summary)                return 'summary required'
  if (typeof b.createdAt  !== 'string' || !b.createdAt)              return 'createdAt required (ISO-8601)'
  if (typeof b.model      !== 'string' || !b.model)                  return 'model required'
  if (typeof b.promptHash !== 'string' || !b.promptHash)             return 'promptHash required'
  if (!Array.isArray(b.entities) || !b.entities.length)              return 'entities must be a non-empty array'

  const payloads = new Map<string, EntityPayload>()
  const entityRefs: BundleEntityRef[] = []

  for (const e of b.entities) {
    if (!e || typeof e !== 'object') return 'entities[] entries must be objects'
    const ent = e as Record<string, unknown>
    if (typeof ent.entityId !== 'string') return 'entities[].entityId required'
    const eid = ent.entityId

    const idMatch = eid.match(ENTITY_ID_RE)
    if (!idMatch) return `entities[].entityId "${eid}" must match \`<Kind>:<slug>\``
    const [, kind] = idMatch
    if (!ENTITY_KINDS.has(kind)) return `entities[].entityId "${eid}" — unknown kind: ${kind}`

    if (!Array.isArray(ent.ops) || !ent.ops.length) return `entities[${eid}].ops must be a non-empty array`

    const validatedOps: BundleOp[] = []
    const opSummary: string[] = []

    for (const rawOp of ent.ops) {
      if (!rawOp || typeof rawOp !== 'object') return `entities[${eid}].ops[] entries must be objects`
      const op = rawOp as Record<string, unknown>
      if (typeof op.op !== 'string' || !OP_TYPES.has(op.op)) {
        return `entities[${eid}].ops[].op must be one of: ${[...OP_TYPES].join(', ')} (got "${String(op.op)}")`
      }

      const opErr = validateOp(eid, op)
      if (typeof opErr === 'string') return opErr

      validatedOps.push(op as BundleOp)
      opSummary.push(summarizeOp(op as BundleOp))
    }

    const df = validateDerivedFrom(origin, ent.derivedFrom)
    if (typeof df === 'string') return `entities[${eid}].${df}`

    payloads.set(eid, {
      entityId:    eid,
      ops:         validatedOps,
      derivedFrom: df,
      source:      typeof ent.source === 'string' ? ent.source
                 : 'outlineId' in df ? `claude:outline:${df.outlineId}` : `sanity:${df.sanityId}`,
      generatedAt: typeof ent.generatedAt === 'string' ? ent.generatedAt : b.createdAt,
    })
    entityRefs.push({ entityId: eid, status: 'pending', opSummary })
  }

  return {
    manifest: {
      bundleId:   b.bundleId,
      ...origin,
      summary:    b.summary,
      createdAt:  b.createdAt,
      model:      b.model,
      promptHash: b.promptHash,
      entities:   entityRefs,
    },
    payloads,
    issueNumber: typeof b.issueNumber === 'number' ? b.issueNumber : null,
  }
}

function validateOp(eid: string, op: Record<string, unknown>): string | null {
  switch (op.op) {
    case 'create-entity': {
      if (typeof op.kind !== 'string' || !ENTITY_KINDS.has(op.kind))    return `${eid} create-entity: kind invalid`
      if (typeof op.slug !== 'string' || !SLUG_RE.test(op.slug))        return `${eid} create-entity: slug must match /^[a-z0-9-]+$/`
      if (`${op.kind}:${op.slug}` !== eid)                              return `${eid} create-entity: kind:slug must match the entity's entityId`
      if (!op.props || typeof op.props !== 'object')                    return `${eid} create-entity: props required`
      if (op.edges !== undefined) {
        if (!Array.isArray(op.edges)) return `${eid} create-entity: edges must be an array`
        for (const edge of op.edges) {
          const err = validateEdge(eid, edge as Record<string, unknown>)
          if (err) return err
        }
      }
      if (op.descriptions !== undefined) {
        if (!Array.isArray(op.descriptions)) return `${eid} create-entity: descriptions must be an array`
        for (const d of op.descriptions) {
          if (!d || typeof d !== 'object')                                  return `${eid} create-entity: description must be object`
          const dd = d as Record<string, unknown>
          if (!Number.isInteger(dd.order) || (dd.order as number) < 1)      return `${eid} create-entity: description.order must be int >= 1`
          if (typeof dd.content !== 'string')                                return `${eid} create-entity: description.content must be string (JSON-encoded PT array)`
          try { JSON.parse(dd.content) } catch                                { return `${eid} create-entity: description.content must be JSON` }
        }
      }
      return null
    }
    case 'modify-block': {
      if (typeof op.blockPath !== 'string' || !BLOCK_PATH_RE.test(op.blockPath)) return `${eid} modify-block: blockPath must match section.<slug>.block.<key>`
      if (typeof op.expectedSha !== 'string')                                    return `${eid} modify-block: expectedSha required (may be empty for v1)`
      if (!op.newValue || typeof op.newValue !== 'object')                       return `${eid} modify-block: newValue required`
      const nv = op.newValue as Record<string, unknown>
      if (nv._type !== 'block' || !Array.isArray(nv.children))                   return `${eid} modify-block: newValue must be PT block (_type "block", children[])`
      return null
    }
    case 'add-edge':
    case 'remove-edge': {
      if (typeof op.type !== 'string' || !op.type)                                  return `${eid} ${op.op}: type required`
      if (!isNodeRef(op.from))                                                      return `${eid} ${op.op}: from must be <Kind>:<slug> or Source:<id>`
      if (!isNodeRef(op.to))                                                        return `${eid} ${op.op}: to must be <Kind>:<slug> or Source:<id>`
      // For add-edge, the target must resolve. v1: we accept "live entity" optimistically — only check that
      // edges to entities-being-created-elsewhere-in-this-bundle do resolve (caught by pass-1 createdEntityIds).
      // Live-entity existence is validated at apply time.
      return null
    }
    case 'delete-entity':     return null
    case 'set-props': {
      const props = op.props as Record<string, unknown> | undefined
      if (!props || typeof props !== 'object' || !Object.keys(props).length) return `${eid} set-props: props must be a non-empty object`
      for (const [name, change] of Object.entries(props)) {
        if (!PROP_NAME_RE.test(name) || PROTECTED_PROPS.has(name)) return `${eid} set-props: property "${name}" not allowed`
        const c = change as Record<string, unknown> | null
        if (!c || typeof c !== 'object' || !('from' in c) || !('to' in c)) return `${eid} set-props: ${name} needs {from, to}`
        const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
        if (!scalar(c.from) || !scalar(c.to)) return `${eid} set-props: ${name} from/to must be scalars or null`
      }
      return null
    }
    case 'set-kind': {
      const kind = eid.match(ENTITY_ID_RE)?.[1]
      if (kind !== 'Operation' && kind !== 'Incident')      return `${eid} set-kind: only valid on Operation/Incident entities`
      if (op.to !== 'Operation' && op.to !== 'Incident')    return `${eid} set-kind: to must be "Operation" or "Incident"`
      if (op.to === kind)                                    return `${eid} set-kind: already ${kind}`
      return null
    }
    case 'obsolete-outline': {
      if (typeof op.reason !== 'string' || !op.reason) return `${eid} obsolete-outline: reason required`
      const idMatch = eid.match(ENTITY_ID_RE)
      if (!idMatch || idMatch[1] !== 'Outline')        return `${eid} obsolete-outline: only valid on Outline entities`
      return null
    }
    default: return `${eid} unknown op: ${String(op.op)}`
  }
}

function validateEdge(eid: string, edge: Record<string, unknown>): string | null {
  if (!edge || typeof edge !== 'object')                              return `${eid} create-entity: edge must be object`
  if (typeof edge.type !== 'string' || !edge.type)                    return `${eid} create-entity: edge.type required`
  if (!isNodeRef(edge.to))                                             return `${eid} create-entity: edge.to must be <Kind>:<slug> or Source:<id>`
  // v1: don't enforce that edge.to resolves — apply-time check will catch.
  return null
}

function summarizeOp(op: BundleOp): string {
  switch (op.op) {
    case 'create-entity':    return `create${op.edges?.length ? ` (+${op.edges.length} edge${op.edges.length === 1 ? '' : 's'})` : ''}`
    case 'modify-block':     return `modify ${op.blockPath}`
    case 'add-edge':         return `+${op.type} → ${op.to}`
    case 'remove-edge':      return `-${op.type} → ${op.to}`
    case 'delete-entity':    return 'delete'
    case 'obsolete-outline': return 'archive'
    case 'set-props':        return Object.entries(op.props)
      .map(([k, { from, to }]) => `${k}: ${fmt(from)} → ${fmt(to)}`).join('; ')
    case 'set-kind':         return op.to === 'Incident'
      ? 'kind → Incident (drops ORCHESTRATED_BY and unit participation)'
      : 'kind → Operation'
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 60 ? `«${s.slice(0, 57)}…»` : `«${s}»`
}

async function writeBundle(env: Env, v: ValidatedBundle): Promise<void> {
  const bundleId = v.manifest.bundleId

  // 1. Manifest
  await env.PROPOSALS.put(
    `proposals/bundles/${bundleId}/manifest.json`,
    JSON.stringify(v.manifest),
    { httpMetadata: { contentType: 'application/json' } },
  )

  // 2. Per-entity payloads
  for (const [entityId, payload] of v.payloads) {
    await env.PROPOSALS.put(
      `proposals/bundles/${bundleId}/entity/${entityId}.json`,
      JSON.stringify(payload),
      { httpMetadata: { contentType: 'application/json' } },
    )
  }

  // 3. by-entity indices (one bundleId added per affected entity)
  for (const entityId of v.payloads.keys()) {
    await appendToIndex(env, `proposals/by-entity/${entityId}/index.json`, bundleId)
  }

  // 4. Source index (by-outline / by-source)
  await appendToIndex(env, sourceIndexKey(v.manifest), bundleId)
}

/** Read an index (or initialize empty), add the bundleId if not present, write back. If-Match conditional. */
async function appendToIndex(env: Env, key: string, bundleId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await env.PROPOSALS.get(key)
    let index: IndexFile
    let etag: string | undefined

    if (existing) {
      etag  = stripEtag(existing.httpEtag)
      index = await existing.json<IndexFile>()
      if (index.bundleIds.includes(bundleId)) return  // already indexed; idempotent
    } else {
      index = { bundleIds: [] }
    }

    index.bundleIds.push(bundleId)

    const opts: R2PutOptions = { httpMetadata: { contentType: 'application/json' } }
    opts.onlyIf = etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' }

    const result = await env.PROPOSALS.put(key, JSON.stringify(index), opts)
    if (result) return
  }
  throw new Error(`index conditional write failed after 3 attempts (${key})`)
}

async function commentAndClose(env: Env, v: ValidatedBundle): Promise<void> {
  if (!v.issueNumber || !env.GITHUB_TOKEN || !env.GITHUB_REPO || !isOutlineBundle(v.manifest)) return

  const reviewUrl = env.ADMIN_BASE_URL
    ? `${env.ADMIN_BASE_URL}/admin/proposals/${v.manifest.bundleId}`
    : `(set ADMIN_BASE_URL to enable review-link)`

  const entityList = v.manifest.entities.map((e) => `- \`${e.entityId}\` — ${e.opSummary.join(', ')}`).join('\n')

  const body = [
    'Bundle landed in R2.',
    '',
    `**Bundle:** \`${v.manifest.bundleId}\``,
    `**Outline:** \`${v.manifest.outlineId}\` (rev \`${v.manifest.outlineRev.slice(0, 8)}\`)`,
    `**Entities affected (${v.manifest.entities.length}):**`,
    '',
    entityList,
    '',
    `[Review in admin →](${reviewUrl})`,
  ].join('\n')

  const headers = {
    'Authorization':        `Bearer ${env.GITHUB_TOKEN}`,
    'Accept':               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':           'milorg-proposals/1.0',
    'Content-Type':         'application/json',
  }

  await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues/${v.issueNumber}/comments`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ body }),
  })
  await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues/${v.issueNumber}`, {
    method:  'PATCH',
    headers,
    body:    JSON.stringify({ state: 'closed' }),
  })
}

async function verifyHmac(body: ArrayBuffer, header: string, secret: string): Promise<boolean> {
  const expected = header.replace(/^sha256=/, '')
  if (!expected) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, body)
  const actual = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')

  return timingSafeEqual(expected, actual)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** R2's `httpEtag` returns the HTTP-quoted form (`"abc"`); the conditional
 *  put's `etagMatches` rejects the quotes. Strip them. */
interface RefScan { unresolved: string[] }

async function resolveBundleRefs(env: Env, v: ValidatedBundle): Promise<RefScan> {
  const created = new Set<string>()  // entities being created in this bundle
  const targets = new Set<string>()  // edge target ids referenced

  for (const [entityId, payload] of v.payloads) {
    for (const op of payload.ops) {
      if (op.op === 'create-entity') {
        created.add(entityId)
        for (const e of op.edges ?? []) targets.add(e.to)
      } else if (op.op === 'add-edge' || op.op === 'remove-edge') {
        targets.add(op.to)
      }
    }
  }

  const toCheck = [...targets].filter((id) => !created.has(id))
  if (!toCheck.length) return { unresolved: [] }

  // Group by kind for batched Cypher. Sources are keyed by id, the rest by slug.
  const byKind: Record<string, string[]> = {}
  for (const id of toCheck) {
    const ref = parseNodeRef(id)
    if (!ref || (ref.kind !== 'Source' && !ENTITY_KINDS.has(ref.kind))) continue
    ;(byKind[ref.kind] ||= []).push(ref.key)
  }

  const found = new Set<string>()
  for (const [kind, keys] of Object.entries(byKind)) {
    const prop = keyProp(kind)
    try {
      const rows = await runCypher<{ key: string }>(
        env,
        `MATCH (n:\`${kind}\`) WHERE n.${prop} IN $keys RETURN n.${prop} AS key`,
        { keys },
      )
      for (const r of rows) found.add(`${kind}:${r.key}`)
    } catch (e) {
      console.error(`resolveBundleRefs ${kind}:`, (e as Error).message)
    }
  }

  return { unresolved: toCheck.filter((id) => !found.has(id)) }
}

async function runCypher<T>(env: Env, statement: string, parameters: Record<string, unknown>): Promise<T[]> {
  const uri  = (env.NEO4J_HTTP_URI ?? coerceHttp(env.NEO4J_URI)).replace(/\/$/, '')
  const auth = btoa(`${env.NEO4J_USERNAME}:${env.NEO4J_PASSWORD}`)
  const res  = await fetch(`${uri}/db/neo4j/tx/commit`, {
    method:  'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({ statements: [{ statement, parameters }] }),
  })
  if (!res.ok) throw new Error(`Neo4j ${res.status}`)
  interface CypherResp {
    results: { columns: string[]; data: { row: unknown[] }[] }[]
    errors:  { code: string; message: string }[]
  }
  const data = await res.json<CypherResp>()
  if (data.errors?.length) throw new Error(data.errors[0].message)
  const r = data.results[0]
  if (!r) return []
  return r.data.map(({ row }) => {
    const obj: Record<string, unknown> = {}
    r.columns.forEach((c, i) => { obj[c] = row[i] })
    return obj as T
  })
}

function coerceHttp(u: string): string {
  if (u.startsWith('neo4j+s://')) return 'https://' + u.slice('neo4j+s://'.length)
  if (u.startsWith('bolt://'))    return 'http://'  + u.slice('bolt://'.length).replace(':7687', ':7474')
  return u
}

interface WatcherFile { watchers: string[] }

async function appendWatcher(env: Env, entityId: string, bundleId: string): Promise<void> {
  const key = `proposals/pending-resolutions/${entityId}.json`
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await env.PROPOSALS.get(key)
    let data: WatcherFile
    let etag: string | undefined
    if (existing) {
      etag = stripEtag(existing.httpEtag)
      data = await existing.json<WatcherFile>()
      if (data.watchers.includes(bundleId)) return
    } else {
      data = { watchers: [] }
    }
    data.watchers.push(bundleId)
    const opts: R2PutOptions = {
      httpMetadata: { contentType: 'application/json' },
      onlyIf:       etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
    }
    if (await env.PROPOSALS.put(key, JSON.stringify(data), opts)) return
  }
  throw new Error(`appendWatcher: conditional write failed (${entityId})`)
}

async function dispatchResolves(env: Env, manifest: BundleManifest, unresolved: string[]): Promise<void> {
  if (!env.BOT_DISPATCH_URL) {
    console.warn(`[ingest] ${unresolved.length} unresolved refs but BOT_DISPATCH_URL not set — skipping resolve dispatch`)
    return
  }
  const base = new URL(env.BOT_DISPATCH_URL)
  const resolveUrl = `${base.origin}${base.pathname.replace(/\/dispatch$/, '/resolve')}`

  // Dedup: only dispatch for entityIds that don't already have a child
  // bundle in flight. Watcher file existing pre-our-write means another
  // parent already triggered; we just attached as another watcher.
  for (const entityId of unresolved) {
    const watcherKey = `proposals/pending-resolutions/${entityId}.json`
    const existing   = await env.PROPOSALS.get(watcherKey)
    const watchers   = existing ? (await existing.json<WatcherFile>()).watchers : []
    if (watchers.length > 1) continue  // someone else already kicked off resolution

    const body = JSON.stringify({
      type:           'resolve',
      missingId:      entityId,
      parentBundle:   manifest.bundleId,
      parentOutlineId:  manifest.outlineId,
      parentOutlineRev: manifest.outlineRev,
    })
    const sig = 'sha256=' + await hmacHex(env.BOT_INGEST_SECRET, body)
    const resp = await fetch(resolveUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig, 'User-Agent': 'milorg-ingest/1.0' },
      body,
    })
    if (!resp.ok) console.error(`resolve dispatch ${entityId} -> ${resp.status}: ${await resp.text()}`)
  }
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function revalidateParent(env: Env, parentBundleId: string): Promise<void> {
  const manifestKey = `proposals/bundles/${parentBundleId}/manifest.json`
  const manifestObj = await env.PROPOSALS.get(manifestKey)
  if (!manifestObj) return
  const parent = await manifestObj.json<BundleManifest>()

  // Reload payloads to pass to resolveBundleRefs.
  const payloads = new Map<string, EntityPayload>()
  for (const ent of parent.entities) {
    const obj = await env.PROPOSALS.get(`proposals/bundles/${parentBundleId}/entity/${ent.entityId}.json`)
    if (obj) payloads.set(ent.entityId, await obj.json<EntityPayload>())
  }

  const refs = await resolveBundleRefs(env, { manifest: parent, payloads, issueNumber: null })
  const wasBlocked = parent.status === 'blocked'
  parent.unresolvedRefs = refs.unresolved
  parent.status         = refs.unresolved.length ? 'blocked' : 'pending'
  await env.PROPOSALS.put(manifestKey, JSON.stringify(parent), {
    httpMetadata: { contentType: 'application/json' },
  })

  if (wasBlocked && parent.status === 'pending') {
    await broadcast(env, bundleChannel(parent), {
      kind:     'bundle-status',
      bundleId: parent.bundleId,
      status:   'pending',
    })
  }
}

async function broadcast(env: Env, channel: string, event: Record<string, unknown>): Promise<void> {
  if (!env.BUNDLE_EVENTS) return
  try {
    const id   = env.BUNDLE_EVENTS.idFromName(channel)
    const stub = env.BUNDLE_EVENTS.get(id)
    await stub.fetch('https://bundle-events/broadcast', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(event),
    })
  } catch (e) {
    console.error('broadcast failed:', (e as Error).message)
  }
}

function stripEtag(etag: string): string {
  return etag.replace(/^"(.*)"$/, '$1')
}
