/**
 * POST /api/proposals/ingest — receive a Claude-generated proposal from the
 * bot-task GitHub Action. Writes the per-block proposal file to R2 + updates
 * the entity's index.json + comments on + closes the source issue.
 *
 * Auth: HMAC-SHA256 on the raw request body, header `X-Hub-Signature-256`.
 * NOT admin-session-gated — the Action authenticates with the shared secret.
 *
 * v1 limitation: `expectedSha` is stored as the bot sent it (or empty). Drift
 * detection at read time computes the live Neo4j sha and compares. Once
 * /api/entity/<kind>/<slug>/context exists and the bot fetches current state
 * before generating, expectedSha will land here pre-populated.
 */

interface Env {
  PROPOSALS:        R2Bucket
  BOT_INGEST_SECRET: string
  GITHUB_TOKEN:     string
  GITHUB_REPO:      string
  // Used by ingest to construct admin review URLs in issue comments.
  ADMIN_BASE_URL?:  string  // e.g. "https://milorg.pages.dev"
}

const ENTITY_KINDS = new Set([
  'Person', 'Unit', 'Station', 'Transport',
  'Operation', 'Incident', 'Location', 'Outline',
])
const SLUG_RE       = /^[a-z0-9-]+$/
const BLOCK_PATH_RE = /^section\.[a-z0-9-]+\.block\.[A-Za-z0-9_-]+$/

interface IngestBody {
  entityId:     unknown
  blockPath:    unknown
  newValue:     unknown
  derivedFrom:  unknown
  model:        unknown
  generatedAt:  unknown
  promptHash:   unknown
  expectedSha?: unknown
  issueNumber?: unknown
  // Optional fields the bot may carry through:
  conflict?:    unknown
  source?:      unknown
  aiGenerated?: unknown
  skip?:        unknown
}

interface ValidatedIngest {
  entityId:     string  // "<kind>:<slug>"
  kind:         string
  slug:         string
  blockPath:    string
  newValue:     unknown  // PT block JSON, opaque here
  derivedFrom:  { outlineId: string; sectionPath: string; outlineRev: string }
  model:        string
  generatedAt:  string
  promptHash:   string
  expectedSha:  string
  issueNumber:  number | null
  source:       string
  aiGenerated:  boolean
  conflict:     boolean
}

interface IndexEntry {
  blockPath:   string
  source:      string
  generatedAt: string
}

interface ProposalIndex {
  entityId: string
  blocks:   IndexEntry[]
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

  const validated = validate(parsed)
  if (typeof validated === 'string') return json({ error: validated }, 400)

  try {
    const r2Path = await writeProposal(env, validated)
    await commentAndClose(env, validated, r2Path).catch((e) => {
      // Issue close failure is non-fatal — proposal is durable in R2.
      console.error('issue comment/close failed:', (e as Error).message)
    })
    return json({ ok: true, r2Path, blockPath: validated.blockPath, entityId: validated.entityId })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function validate(b: IngestBody): ValidatedIngest | string {
  if (typeof b.entityId !== 'string') return 'entityId must be a string'
  const m = b.entityId.match(/^([A-Za-z]+):([a-z0-9-]+)$/)
  if (!m) return 'entityId must match `<Kind>:<slug>`'
  const [, kind, slug] = m
  if (!ENTITY_KINDS.has(kind)) return `entityId kind must be one of: ${[...ENTITY_KINDS].join(', ')}`
  if (!SLUG_RE.test(slug)) return 'entityId slug must match /^[a-z0-9-]+$/'

  if (typeof b.blockPath !== 'string' || !BLOCK_PATH_RE.test(b.blockPath)) {
    return 'blockPath must match `section.<slug>.block.<key>`'
  }

  // newValue is an opaque PT block — minimal shape check
  if (!b.newValue || typeof b.newValue !== 'object' || Array.isArray(b.newValue)) {
    return 'newValue must be an object (Portable Text block)'
  }
  const nv = b.newValue as Record<string, unknown>
  if (nv._type !== 'block' || !Array.isArray(nv.children)) {
    return 'newValue must be a Portable Text block with _type: "block" and children[]'
  }

  if (!b.derivedFrom || typeof b.derivedFrom !== 'object') return 'derivedFrom must be an object'
  const df = b.derivedFrom as Record<string, unknown>
  if (typeof df.outlineId   !== 'string' || !df.outlineId)   return 'derivedFrom.outlineId required'
  if (typeof df.sectionPath !== 'string' || !df.sectionPath) return 'derivedFrom.sectionPath required'
  if (typeof df.outlineRev  !== 'string' || !df.outlineRev)  return 'derivedFrom.outlineRev required'

  if (typeof b.model        !== 'string' || !b.model)        return 'model required'
  if (typeof b.generatedAt  !== 'string' || !b.generatedAt)  return 'generatedAt required (ISO-8601)'
  if (typeof b.promptHash   !== 'string' || !b.promptHash)   return 'promptHash required'

  const expectedSha = typeof b.expectedSha === 'string' ? b.expectedSha : ''
  const issueNumber = typeof b.issueNumber === 'number' ? b.issueNumber : null
  const source      = typeof b.source === 'string' ? b.source : `claude:outline:${df.outlineId}:${df.sectionPath}`
  const aiGenerated = typeof b.aiGenerated === 'boolean' ? b.aiGenerated : true
  const conflict    = typeof b.conflict === 'boolean' ? b.conflict : false

  return {
    entityId:    b.entityId,
    kind, slug,
    blockPath:   b.blockPath,
    newValue:    b.newValue,
    derivedFrom: { outlineId: df.outlineId, sectionPath: df.sectionPath, outlineRev: df.outlineRev },
    model:       b.model,
    generatedAt: b.generatedAt,
    promptHash:  b.promptHash,
    expectedSha,
    issueNumber,
    source,
    aiGenerated,
    conflict,
  }
}

async function writeProposal(env: Env, p: ValidatedIngest): Promise<string> {
  const safePath = encodePathComponent(p.blockPath)
  const proposalKey = `proposals/${p.entityId}/${safePath}.json`

  const proposalBody = {
    entityId:     p.entityId,
    blockPath:    p.blockPath,
    expectedSha:  p.expectedSha,
    newValue:     p.newValue,
    derivedFrom:  p.derivedFrom,
    source:       p.source,
    model:        p.model,
    generatedAt:  p.generatedAt,
    promptHash:   p.promptHash,
    aiGenerated:  p.aiGenerated,
    conflict:     p.conflict,
  }

  // Newest-wins: a fresh bot run supersedes any stale prior proposal.
  await env.PROPOSALS.put(proposalKey, JSON.stringify(proposalBody), {
    httpMetadata: { contentType: 'application/json' },
  })

  await updateIndex(env, p.entityId, p.blockPath, p.source, p.generatedAt)

  return proposalKey
}

async function updateIndex(
  env: Env,
  entityId: string,
  blockPath: string,
  source: string,
  generatedAt: string,
): Promise<void> {
  const key = `proposals/${entityId}/index.json`

  // If-Match retry loop: read → mutate → conditional write. Up to 3 attempts.
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await env.PROPOSALS.get(key)
    let index: ProposalIndex
    let etag: string | undefined

    if (existing) {
      etag = existing.httpEtag
      index = await existing.json<ProposalIndex>()
    } else {
      index = { entityId, blocks: [] }
    }

    // Replace any prior entry for this blockPath
    index.blocks = index.blocks.filter((e) => e.blockPath !== blockPath)
    index.blocks.push({ blockPath, source, generatedAt })

    const opts: R2PutOptions = {
      httpMetadata: { contentType: 'application/json' },
    }
    if (etag) opts.onlyIf = { etagMatches: etag }
    else      opts.onlyIf = { etagDoesNotMatch: '*' }   // only-if-doesn't-exist (S3 If-None-Match: *)

    const result = await env.PROPOSALS.put(key, JSON.stringify(index), opts)
    if (result) return  // success
    // null = precondition failed; loop and retry
  }
  throw new Error(`index.json conditional write failed after 3 attempts (${key})`)
}

async function commentAndClose(env: Env, p: ValidatedIngest, r2Path: string): Promise<void> {
  if (!p.issueNumber || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return

  const reviewUrl = env.ADMIN_BASE_URL
    ? `${env.ADMIN_BASE_URL}/${p.kind.toLowerCase()}/${p.slug}#proposal=${encodeURIComponent(p.blockPath)}`
    : `(set ADMIN_BASE_URL to enable review-link)`

  const body = [
    'Proposal landed in R2.',
    '',
    `**R2 path:** \`${r2Path}\``,
    `**Block:** \`${p.blockPath}\``,
    `**Source:** \`${p.source}\``,
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

  await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues/${p.issueNumber}/comments`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ body }),
  })
  await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues/${p.issueNumber}`, {
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

/** R2 keys can't contain `/` mid-segment without creating folders. blockPath
 *  uses `.` as separator so it's safe; this is just defensive. */
function encodePathComponent(s: string): string {
  return s.replace(/\//g, '_')
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
