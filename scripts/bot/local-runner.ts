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

http.createServer((req, res) => {
  void handleDispatch(req, res)
}).listen(PORT, () => {
  console.log(`[runner] listening on http://localhost:${PORT}/dispatch`)
  console.log(`[runner] context base: ${CONTEXT_BASE}`)
  console.log(`[runner] ingest:       ${INGEST_URL}`)
})

async function handleDispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST' || req.url !== '/dispatch') {
    reply(res, 404, { error: 'Use POST /dispatch' })
    return
  }
  try {
    const raw = await readBody(req)
    if (!verifyHmac(raw, req.headers['x-hub-signature-256'] as string ?? '', SECRET)) {
      reply(res, 401, { error: 'Invalid signature' })
      return
    }
    const payload = JSON.parse(raw) as DispatchBody
    console.log(`[runner] dispatch ${payload.outlineId} rev=${payload.outlineRev.slice(0, 8)}`)

    // Reply immediately with a stub issueNumber/issueUrl so the admin UI
    // unblocks; the real work continues in the background.
    reply(res, 200, {
      issueNumber: 0,
      issueUrl:    `local://dispatch/${payload.outlineId}/${Date.now()}`,
    })

    void runBundlePipeline(payload).catch((e: Error) => {
      console.error('[runner] pipeline failed:', e.message)
    })
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
