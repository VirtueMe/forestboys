/**
 * POST /api/proposals/request — request a Claude-generated proposal bundle
 * absorbing one outline.
 *
 * Two dispatch backends, env-selected:
 *
 *   - **GitHub** (production, default): create a `bot-task` issue carrying
 *     the request payload. The Action runs Claude and POSTs the bundle to
 *     /api/proposals/ingest.
 *   - **Local** (smoke testing): if `BOT_DISPATCH_URL` is set, HMAC-POST
 *     the request payload there instead. A local runner
 *     (`scripts/bot/local-runner.ts`) accepts the dispatch, renders the
 *     prompt, shells out to `claude -p`, and POSTs the bundle to ingest.
 *
 * Admin-session-gated. The endpoint itself is fast — dispatch is the only
 * side effect — but the resulting bot work is async (seconds locally,
 * minutes on GitHub).
 *
 * Body: { outlineId, outlineRev, promptHash }. Returns {issueNumber, issueUrl}.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'

interface Env {
  SESSION_SECRET:     string
  GITHUB_TOKEN?:      string  // PAT with `issues:write` on the milorg repo
  GITHUB_REPO?:       string  // "<owner>/<repo>", e.g. "motstandsbevegelsen/milorg"
  BOT_DISPATCH_URL?:  string  // local smoke-test runner URL — overrides GitHub
  BOT_INGEST_SECRET?: string  // shared secret for dispatch HMAC + ingest HMAC
}

const SLUG_RE        = /^[a-z0-9-]+$/
const PROMPT_HASH_RE = /^[a-f0-9]{12}$/

interface BundleRequest {
  outlineId:  unknown
  outlineRev: unknown
  promptHash: unknown
}

interface ValidatedRequest {
  outlineId:  string
  outlineRev: string
  promptHash: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const body = await request.json<BundleRequest>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const validated = validate(body)
  if (typeof validated === 'string') return json({ error: validated }, 400)

  try {
    if (env.BOT_DISPATCH_URL) {
      if (!env.BOT_INGEST_SECRET) return json({ error: 'BOT_INGEST_SECRET not configured (required for local dispatch)' }, 500)
      const result = await dispatchLocal(env.BOT_DISPATCH_URL, env.BOT_INGEST_SECRET, validated)
      return json(result)
    }
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
      return json({ error: 'GITHUB_TOKEN / GITHUB_REPO not configured' }, 500)
    }
    const issue = await createBotTaskIssue(env as Required<Env>, validated)
    return json({ issueNumber: issue.number, issueUrl: issue.html_url })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

async function dispatchLocal(
  url:    string,
  secret: string,
  req:    ValidatedRequest,
): Promise<{ issueNumber: number; issueUrl: string }> {
  const body = JSON.stringify(req)
  const sig  = 'sha256=' + await hmacHex(secret, body)
  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':         'application/json',
      'X-Hub-Signature-256':  sig,
      'User-Agent':           'milorg-proposals/1.0',
    },
    body,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`local dispatch ${resp.status}: ${text}`)
  }
  return await resp.json<{ issueNumber: number; issueUrl: string }>()
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function validate(b: BundleRequest): ValidatedRequest | string {
  if (typeof b.outlineId !== 'string' || !SLUG_RE.test(b.outlineId)) {
    return 'outlineId must match /^[a-z0-9-]+$/'
  }
  if (typeof b.outlineRev !== 'string' || !b.outlineRev.trim()) {
    return 'outlineRev must be a non-empty string'
  }
  if (typeof b.promptHash !== 'string' || !PROMPT_HASH_RE.test(b.promptHash)) {
    return 'promptHash must be 12 lowercase hex chars'
  }
  return {
    outlineId:  b.outlineId,
    outlineRev: b.outlineRev.trim(),
    promptHash: b.promptHash,
  }
}

interface GhIssue {
  number:    number
  html_url:  string
}

async function createBotTaskIssue(env: Required<Env>, req: ValidatedRequest): Promise<GhIssue> {
  const title  = `bot-task: absorb outline ${req.outlineId} (rev ${req.outlineRev.slice(0, 8)})`
  const body   = renderIssueBody(req)
  const labels = ['bot-task', `outline:${req.outlineId}`]

  const resp = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method:  'POST',
    headers: {
      'Authorization':         `Bearer ${env.GITHUB_TOKEN}`,
      'Accept':                'application/vnd.github+json',
      'X-GitHub-Api-Version':  '2022-11-28',
      'User-Agent':            'milorg-proposals/1.0',
      'Content-Type':          'application/json',
    },
    body: JSON.stringify({ title, body, labels }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`GitHub issues API ${resp.status}: ${text}`)
  }
  return await resp.json<GhIssue>()
}

function renderIssueBody(req: ValidatedRequest): string {
  // Mirrors .github/ISSUE_TEMPLATE/bot-task.md so a human inspecting the
  // bot-created issue sees the same shape as the template documentation.
  // The Action's parser only requires the first ```json fence to be the
  // request payload.
  const payload = JSON.stringify(req, null, 2)
  return [
    '<!-- Auto-created by /api/proposals/request. Do not edit by hand. -->',
    '',
    '## Request',
    '',
    'Generate a bundle absorbing the outline below. The bundle should',
    'contain ops creating any new entities (Operation, Person, Location,',
    'etc.) the outline calls for, modify-block ops on existing entities',
    'where the outline updates their descriptions, and an obsolete-outline',
    'op once the absorption is complete.',
    '',
    '```json',
    payload,
    '```',
    '',
    '## Re-running',
    '',
    'Edit-and-save (or re-add the `bot-task` label) to re-trigger the Action.',
    'A fresh run produces a new bundle with a different bundleId — bundles',
    'are timestamp-stamped so they don\'t collide.',
  ].join('\n')
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
