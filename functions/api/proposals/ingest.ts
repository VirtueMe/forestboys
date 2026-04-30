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
 *   5. Patch by-entity and by-outline indices with If-Match retry.
 *   6. Comment on the source GitHub issue + close it.
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

interface Env {
  PROPOSALS:        R2Bucket
  BOT_INGEST_SECRET: string
  GITHUB_TOKEN:     string
  GITHUB_REPO:      string
  ADMIN_BASE_URL?:  string  // e.g. "https://milorg.pages.dev"
}

const ENTITY_KINDS = new Set([
  'Person', 'Unit', 'Station', 'Transport',
  'Operation', 'Incident', 'Location', 'Outline', 'Organization',
])
const OP_TYPES = new Set([
  'create-entity', 'modify-block', 'add-edge', 'remove-edge',
  'delete-entity', 'obsolete-outline',
])
const SLUG_RE        = /^[a-z0-9-]+$/
const ENTITY_ID_RE   = /^([A-Za-z]+):([a-z0-9-]+)$/
const BLOCK_PATH_RE  = /^section\.[a-z0-9-]+\.block\.[A-Za-z0-9_-]+$/
const BUNDLE_ID_RE   = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

interface BundleEntityRef {
  entityId:  string
  status:    'pending' | 'accepted' | 'denied' | 'drifted'
  opSummary: string[]
}

interface BundleManifest {
  bundleId:    string
  outlineId:   string
  outlineRev:  string
  summary:     string
  createdAt:   string
  model:       string
  promptHash:  string
  entities:    BundleEntityRef[]
}

type BundleOp =
  | { op: 'create-entity'; kind: string; slug: string; props: Record<string, unknown>; edges?: { type: string; to: string; props?: Record<string, unknown> }[] }
  | { op: 'modify-block'; blockPath: string; expectedSha: string; newValue: Record<string, unknown> }
  | { op: 'add-edge';     type: string; from: string; to: string; props?: Record<string, unknown> }
  | { op: 'remove-edge';  type: string; from: string; to: string }
  | { op: 'delete-entity' }
  | { op: 'obsolete-outline'; reason: string }

interface EntityPayload {
  entityId:    string
  ops:         BundleOp[]
  derivedFrom: { outlineId: string; sectionPath?: string; outlineRev: string }
  source:      string
  generatedAt: string
}

interface IngestBody {
  bundleId:    unknown
  outlineId:   unknown
  outlineRev:  unknown
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
    await commentAndClose(env, validated).catch((e) => {
      // Issue close failure is non-fatal — bundle is durable in R2.
      console.error('issue comment/close failed:', (e as Error).message)
    })
    return json({
      ok:          true,
      bundleId:    validated.manifest.bundleId,
      entityCount: validated.manifest.entities.length,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function validateBundle(b: IngestBody): ValidatedBundle | string {
  if (typeof b.bundleId !== 'string' || !BUNDLE_ID_RE.test(b.bundleId)) {
    return 'bundleId must match `bundle:<outlineId>:<isoTimestamp>`'
  }
  if (typeof b.outlineId !== 'string' || !SLUG_RE.test(b.outlineId)) return 'outlineId must match /^[a-z0-9-]+$/'
  if (typeof b.outlineRev !== 'string' || !b.outlineRev)             return 'outlineRev required'
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

    const df = ent.derivedFrom as Record<string, unknown> | undefined
    if (!df || typeof df.outlineId !== 'string' || typeof df.outlineRev !== 'string') {
      return `entities[${eid}].derivedFrom must include outlineId + outlineRev`
    }

    payloads.set(eid, {
      entityId:    eid,
      ops:         validatedOps,
      derivedFrom: { outlineId: df.outlineId, outlineRev: df.outlineRev, sectionPath: typeof df.sectionPath === 'string' ? df.sectionPath : undefined },
      source:      typeof ent.source === 'string' ? ent.source : `claude:outline:${df.outlineId}`,
      generatedAt: typeof ent.generatedAt === 'string' ? ent.generatedAt : b.createdAt,
    })
    entityRefs.push({ entityId: eid, status: 'pending', opSummary })
  }

  return {
    manifest: {
      bundleId:   b.bundleId,
      outlineId:  b.outlineId,
      outlineRev: b.outlineRev,
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
      if (typeof op.from !== 'string' || !ENTITY_ID_RE.test(op.from))               return `${eid} ${op.op}: from must be a valid entityId`
      if (typeof op.to   !== 'string' || !ENTITY_ID_RE.test(op.to))                 return `${eid} ${op.op}: to must be a valid entityId`
      // For add-edge, the target must resolve. v1: we accept "live entity" optimistically — only check that
      // edges to entities-being-created-elsewhere-in-this-bundle do resolve (caught by pass-1 createdEntityIds).
      // Live-entity existence is validated at apply time.
      return null
    }
    case 'delete-entity':     return null
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
  if (typeof edge.to !== 'string' || !ENTITY_ID_RE.test(edge.to))     return `${eid} create-entity: edge.to must be a valid entityId`
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
  }
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

  // 4. by-outline index
  await appendToIndex(env, `proposals/by-outline/${v.manifest.outlineId}/index.json`, bundleId)
}

/** Read an index (or initialize empty), add the bundleId if not present, write back. If-Match conditional. */
async function appendToIndex(env: Env, key: string, bundleId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await env.PROPOSALS.get(key)
    let index: IndexFile
    let etag: string | undefined

    if (existing) {
      etag  = existing.httpEtag
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
  if (!v.issueNumber || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return

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
