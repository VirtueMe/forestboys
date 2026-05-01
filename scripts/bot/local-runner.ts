/**
 * Local smoke-test runner — replaces the GitHub Action for dev.
 *
 * Listens on POST /dispatch. Mirrors `.github/workflows/bot-task.yml`
 * step-for-step:
 *   1. Verify HMAC (X-Hub-Signature-256, BOT_INGEST_SECRET).
 *   2. GET /api/entity/Outline/<outlineId>/context from local CF dev.
 *   3. Render `scripts/prompts/proposal-bundle.txt` with vars.
 *   4. Spawn `claude -p <prompt> --allowedTools Read,Write` (same shape
 *      as ~/bancs/home/scripts/test-social-schedule.py).
 *   5. Read the bundle file Claude wrote.
 *   6. HMAC-POST to /api/proposals/ingest.
 *
 * Reads env via dotenv from `.env`. Required:
 *   BOT_INGEST_SECRET    — shared with CF dev's BOT_INGEST_SECRET
 *   PROPOSAL_INGEST_URL  — e.g. http://localhost:8788/api/proposals/ingest
 * Optional:
 *   ENTITY_CONTEXT_BASE  — defaults to PROPOSAL_INGEST_URL's origin
 *   PORT                 — defaults to 8789
 *   MODEL_ID             — defaults to claude-opus-4-7
 *
 * Then point the CF dev env (`.dev.vars`) at this runner:
 *   BOT_DISPATCH_URL=http://localhost:8789/dispatch
 *
 * Run with: npx tsx scripts/bot/local-runner.ts
 */

import 'dotenv/config'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const PORT                = Number(process.env.PORT ?? 8789)
const SECRET              = required('BOT_INGEST_SECRET')
const INGEST_URL          = required('PROPOSAL_INGEST_URL')
const CONTEXT_BASE        = (process.env.ENTITY_CONTEXT_BASE
                             ?? new URL(INGEST_URL).origin).replace(/\/$/, '')
const PROMPT_PATH         = path.resolve('scripts/prompts/proposal-bundle.txt')
const MODEL_ID            = process.env.MODEL_ID ?? 'claude-opus-4-7'

interface DispatchBody {
  outlineId:  string
  outlineRev: string
  promptHash: string
}

interface ResolveBody {
  type:             'resolve'
  missingId:        string  // <Kind>:<slug>
  parentBundle:     string
  parentOutlineId:  string
  parentOutlineRev: string
}

http.createServer((req, res) => {
  void handleDispatch(req, res)
}).listen(PORT, () => {
  console.log(`[runner] listening on http://localhost:${PORT}/dispatch`)
  console.log(`[runner] context base: ${CONTEXT_BASE}`)
  console.log(`[runner] ingest:       ${INGEST_URL}`)
})

async function handleDispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    reply(res, 405, { error: 'Use POST' })
    return
  }
  try {
    const raw = await readBody(req)
    if (!verifyHmac(raw, req.headers['x-hub-signature-256'] as string ?? '', SECRET)) {
      reply(res, 401, { error: 'Invalid signature' })
      return
    }

    if (req.url === '/dispatch') {
      const payload = JSON.parse(raw) as DispatchBody
      console.log(`[runner] dispatch ${payload.outlineId} rev=${payload.outlineRev.slice(0, 8)}`)
      reply(res, 200, {
        issueNumber: 0,
        issueUrl:    `local://dispatch/${payload.outlineId}/${Date.now()}`,
      })
      void runBundlePipeline(payload).catch((e: Error) => {
        console.error('[runner] pipeline failed:', e.message)
      })
      return
    }

    if (req.url === '/resolve') {
      const payload = JSON.parse(raw) as ResolveBody
      console.log(`[runner] resolve ${payload.missingId} for parent ${payload.parentBundle}`)
      reply(res, 200, { ok: true })
      void runResolvePipeline(payload).catch((e: Error) => {
        console.error('[runner] resolve failed:', e.message)
      })
      return
    }

    reply(res, 404, { error: 'Use POST /dispatch or /resolve' })
  } catch (e) {
    reply(res, 500, { error: (e as Error).message })
  }
}

async function runBundlePipeline(payload: DispatchBody): Promise<void> {
  const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const bundleId  = `bundle:${payload.outlineId}:${createdAt}`
  const outputFile = `/tmp/bundle-${payload.outlineId}-${createdAt.replace(/:/g, '-')}.json`

  // Fetch entity context (Outline + referencedEntities).
  const ctxResp = await fetch(
    `${CONTEXT_BASE}/api/entity/Outline/${payload.outlineId}/context`,
    { headers: { Authorization: `Bearer ${SECRET}`, Accept: 'application/json' } },
  )
  if (!ctxResp.ok) throw new Error(`context fetch ${ctxResp.status}: ${await ctxResp.text()}`)
  const ctx = await ctxResp.json() as { outline: unknown; referencedEntities: unknown }

  const tmpl = await fs.readFile(PROMPT_PATH, 'utf8')
  const vars: Record<string, unknown> = {
    OUTLINE_ID:           payload.outlineId,
    OUTLINE_REV:          payload.outlineRev,
    PROMPT_HASH:          payload.promptHash,
    BUNDLE_ID:            bundleId,
    CREATED_AT:           createdAt,
    MODEL_ID:             MODEL_ID,
    OUTPUT_PATH:          outputFile,
    OUTLINE_JSON:         ctx.outline,
    LIVE_ENTITIES_JSON:   ctx.referencedEntities,
    SIMILAR_ACCEPTS_JSON: [],
    SIMILAR_DENIALS_JSON: [],
  }
  const rendered = tmpl.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Template references undefined var: ${key}`)
    const v = vars[key]
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  })

  console.log(`[runner] running claude -p (output → ${outputFile})`)
  await runClaude(rendered)

  // Read what Claude wrote.
  const bundleRaw = await fs.readFile(outputFile, 'utf8')
  const bundle    = JSON.parse(bundleRaw) as Record<string, unknown>

  if (bundle.skip === true) {
    const reason = typeof bundle.reason === 'string' ? bundle.reason : '(no reason)'
    console.log(`[runner] bot opted out: ${reason}`)
    return
  }

  // Validate edge targets exist (live or being created in this bundle).
  // Missing refs are flagged but the bundle still ingests — Jan resolves
  // them at review time (deny with the correct slug, or fix the entity
  // first then re-run). Apply-time MATCH on a missing target fails the
  // affected op only, not the whole bundle.
  const validation = await validateBundleRefs(bundle)
  if (validation.missing.length || validation.malformed.length) {
    const rewrites: Record<string, string> = {}
    const lines: string[] = []
    for (const id of validation.missing) {
      const s = validation.suggestions[id]
      if (s) {
        rewrites[id] = s.id
        lines.push(`  ${id}  →  ${s.id} (${s.name})  [auto-rewritten, ${s.hits} token match]`)
      } else {
        lines.push(`  ${id}  (no near match — Jan resolves)`)
      }
    }
    if (Object.keys(rewrites).length) rewriteBundleRefs(bundle, rewrites)
    console.warn(
      `[runner] ${validation.missing.length + validation.malformed.length} unresolved reference(s):\n` +
      (lines.length                ? lines.join('\n') + '\n' : '') +
      (validation.malformed.length ? `  malformed: ${validation.malformed.join(', ')}\n` : ''),
    )
  }
  if (validation.conflicts.length) {
    console.warn(
      `[runner] ${validation.conflicts.length} create-entity slug${validation.conflicts.length === 1 ? '' : 's'} already exist in graph — bundle will fail at apply-time:\n` +
      validation.conflicts.map((c) => `  ${c.id} (${c.name}) — already exists; consider modify-block on it instead`).join('\n') + '\n',
    )
  }

  // POST to ingest with HMAC + issueNumber augmentation.
  const augmented = JSON.stringify({ ...bundle, issueNumber: 0 })
  const sig = 'sha256=' + hmacHex(SECRET, augmented)
  const ingestResp = await fetch(INGEST_URL, {
    method:  'POST',
    headers: {
      'Content-Type':         'application/json',
      'X-Hub-Signature-256':  sig,
      'User-Agent':           'milorg-bot-task-local/1.0',
    },
    body: augmented,
  })
  if (!ingestResp.ok) {
    throw new Error(`ingest ${ingestResp.status}: ${await ingestResp.text()}`)
  }
  console.log(`[runner] ingest ok: ${await ingestResp.text()}`)
}

interface BundleEntity { entityId: string; ops: { op: string; to?: string; edges?: { to: string }[] }[] }

function rewriteBundleRefs(bundle: Record<string, unknown>, rewrites: Record<string, string>): void {
  const entities = (bundle.entities as BundleEntity[]) ?? []
  for (const ent of entities) {
    for (const op of ent.ops ?? []) {
      if (op.op === 'add-edge' || op.op === 'remove-edge') {
        if (typeof op.to === 'string' && rewrites[op.to]) op.to = rewrites[op.to]
      } else if (op.op === 'create-entity') {
        for (const e of op.edges ?? []) {
          if (typeof e.to === 'string' && rewrites[e.to]) e.to = rewrites[e.to]
        }
      }
    }
  }
}

interface ValidationResult {
  missing:     string[]
  malformed:   string[]
  suggestions: Record<string, { id: string; name: string; hits: number }>
  /** create-entity slugs that already exist in the live graph. */
  conflicts:   { id: string; name: string }[]
}

async function validateBundleRefs(bundle: Record<string, unknown>): Promise<ValidationResult> {
  const entities = (bundle.entities as BundleEntity[]) ?? []

  // Collect every create-entity id (these are valid even though not in live graph yet).
  const createdIds = new Set<string>()
  for (const ent of entities) {
    for (const op of ent.ops ?? []) {
      if (op.op === 'create-entity') createdIds.add(ent.entityId)
    }
  }

  // Collect every target referenced in add-edge / remove-edge / create-entity.edges.
  const targets = new Set<string>()
  for (const ent of entities) {
    for (const op of ent.ops ?? []) {
      if (op.op === 'add-edge' || op.op === 'remove-edge') {
        if (typeof op.to === 'string') targets.add(op.to)
      } else if (op.op === 'create-entity') {
        for (const e of op.edges ?? []) {
          if (typeof e.to === 'string') targets.add(e.to)
        }
      }
    }
  }

  // Edge targets that need to exist (or be created in this bundle).
  const toCheck = [...targets].filter((id) => !createdIds.has(id))
  // Create-entity slugs need to NOT exist (otherwise it's a duplicate).
  const createCheck = [...createdIds]

  const allIds = [...new Set([...toCheck, ...createCheck])]
  if (!allIds.length) return { missing: [], malformed: [], suggestions: {}, conflicts: [] }

  const lookupUrl = `${CONTEXT_BASE}/api/entity/lookup`
  const resp = await fetch(lookupUrl, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SECRET}`,
    },
    body: JSON.stringify({ ids: allIds }),
  })
  if (!resp.ok) throw new Error(`lookup ${resp.status}: ${await resp.text()}`)
  const data = await resp.json() as ValidationResult & { found: { id: string; name: string }[] }

  const foundSet = new Set(data.found.map((f) => f.id))
  const conflicts = data.found.filter((f) => createdIds.has(f.id))
  // Edge `missing[]` from the endpoint covers the toCheck set; filter to only
  // entries we actually wanted to verify (the endpoint returns missing for
  // every id that wasn't found, including create-checks — which is fine).
  const missing = data.missing.filter((id) => !createdIds.has(id) || !foundSet.has(id))

  return {
    missing,
    malformed:   data.malformed,
    suggestions: data.suggestions ?? {},
    conflicts,
  }
}

async function runResolvePipeline(payload: ResolveBody): Promise<void> {
  const m = payload.missingId.match(/^([A-Za-z]+):([a-z0-9-]+)$/)
  if (!m) throw new Error(`malformed missingId: ${payload.missingId}`)
  const [, kind, slug] = m

  const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const bundleId  = `bundle:${payload.parentOutlineId}:${createdAt}`
  const outputFile = `/tmp/bundle-resolve-${kind}-${slug}-${createdAt.replace(/:/g, '-')}.json`

  // Pull the parent's outline context — the resolve prompt grounds in
  // the same outline body.
  const ctxResp = await fetch(
    `${CONTEXT_BASE}/api/entity/Outline/${payload.parentOutlineId}/context`,
    { headers: { Authorization: `Bearer ${SECRET}`, Accept: 'application/json' } },
  )
  if (!ctxResp.ok) throw new Error(`context fetch ${ctxResp.status}: ${await ctxResp.text()}`)
  const ctx = await ctxResp.json() as { outline: unknown; referencedEntities: unknown }

  const prompt = renderResolvePrompt({
    kind, slug,
    bundleId, createdAt,
    parentBundle: payload.parentBundle,
    outlineId:    payload.parentOutlineId,
    outlineRev:   payload.parentOutlineRev,
    outline:      ctx.outline,
    liveEntities: ctx.referencedEntities,
    outputPath:   outputFile,
  })

  console.log(`[runner] running claude -p (resolve → ${outputFile})`)
  await runClaude(prompt)

  const bundleRaw = await fs.readFile(outputFile, 'utf8')
  const bundle    = JSON.parse(bundleRaw) as Record<string, unknown>

  // Augment with parentBundle + resolvesEntities so ingest can revalidate.
  const augmented = JSON.stringify({
    ...bundle,
    parentBundle:     payload.parentBundle,
    resolvesEntities: [payload.missingId],
    issueNumber:      0,
  })
  const sig = 'sha256=' + hmacHex(SECRET, augmented)
  const ingestResp = await fetch(INGEST_URL, {
    method:  'POST',
    headers: {
      'Content-Type':         'application/json',
      'X-Hub-Signature-256':  sig,
      'User-Agent':           'milorg-bot-task-local/1.0',
    },
    body: augmented,
  })
  if (!ingestResp.ok) throw new Error(`ingest ${ingestResp.status}: ${await ingestResp.text()}`)
  console.log(`[runner] resolve ingest ok: ${await ingestResp.text()}`)
}

interface ResolvePromptVars {
  kind: string; slug: string
  bundleId: string; createdAt: string
  parentBundle: string
  outlineId: string; outlineRev: string
  outline: unknown; liveEntities: unknown
  outputPath: string
}

function renderResolvePrompt(v: ResolvePromptVars): string {
  return `You are creating a single missing entity that another proposal bundle needs.

The parent bundle (${v.parentBundle}) referenced ${v.kind}:${v.slug} but no such
entity exists in the live graph. Your job: produce a small bundle with one
\`create-entity\` op for ${v.kind}:${v.slug}, derived from the same outline
the parent bundle was generated from. Use the outline + live entities for
grounding; do not hallucinate facts.

## Outline

\`\`\`json
${JSON.stringify(v.outline, null, 2)}
\`\`\`

## Live entities the outline references

\`\`\`json
${JSON.stringify(v.liveEntities, null, 2)}
\`\`\`

## Output

Write a single JSON object to ${v.outputPath} matching the bundle shape:

\`\`\`jsonc
{
  "bundleId":   "${v.bundleId}",
  "outlineId":  "${v.outlineId}",
  "outlineRev": "${v.outlineRev}",
  "summary":    "Resolves ${v.kind}:${v.slug} for parent ${v.parentBundle}",
  "createdAt":  "${v.createdAt}",
  "model":      "claude-opus-4-7",
  "promptHash": "resolve000000",
  "entities": [
    {
      "entityId":    "${v.kind}:${v.slug}",
      "ops": [
        { "op": "create-entity", "kind": "${v.kind}", "slug": "${v.slug}", "props": { /* canonicalName + scalars from the outline */ } }
      ],
      "derivedFrom": { "outlineId": "${v.outlineId}", "outlineRev": "${v.outlineRev}" },
      "source":      "claude:resolve:${v.parentBundle}",
      "generatedAt": "${v.createdAt}"
    }
  ]
}
\`\`\`

Rules:
- Exactly one \`create-entity\` op; do not add modify-block, edges, or
  obsolete-outline ops here.
- Stay strictly within what the outline + live entities support. If the
  outline doesn't actually mention the missing entity by a name that could
  produce slug "${v.slug}", write \`{"skip": true, "reason": "<one sentence>"}\`
  to the output file instead and stop.
- Slugs must match /^[a-z0-9-]+$/.
`
}

function runClaude(prompt: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt, '--allowedTools', 'Read,Write'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`claude exited with ${code}`))
    })
  })
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function verifyHmac(body: string, header: string, secret: string): boolean {
  const want = 'sha256=' + hmacHex(secret, body)
  if (header.length !== want.length) return false
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(want))
}

function hmacHex(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function reply(res: http.ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env: ${name}`)
    process.exit(1)
  }
  return v
}
