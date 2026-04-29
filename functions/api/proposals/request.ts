/**
 * POST /api/proposals/request — request a Claude-generated proposal bundle
 * absorbing one outline. Creates a `bot-task` GitHub issue carrying the
 * request payload; the Action runs Claude, which produces a full bundle
 * (manifest + per-entity payloads with create-entity / modify-block /
 * add-edge ops). The Action POSTs the bundle to /api/proposals/ingest.
 *
 * Admin-session-gated. The endpoint itself is fast — issue creation is the
 * only side effect — but the resulting bot work is async (minutes).
 *
 * Body: { outlineId, outlineRev, promptHash }. Returns {issueNumber, issueUrl}.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'

interface Env {
  SESSION_SECRET: string
  GITHUB_TOKEN:   string  // PAT with `issues:write` on the milorg repo
  GITHUB_REPO:    string  // "<owner>/<repo>", e.g. "motstandsbevegelsen/milorg"
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

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return json({ error: 'GITHUB_TOKEN / GITHUB_REPO not configured' }, 500)
  }

  const body = await request.json<BundleRequest>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const validated = validate(body)
  if (typeof validated === 'string') return json({ error: validated }, 400)

  try {
    const issue = await createBotTaskIssue(env, validated)
    return json({ issueNumber: issue.number, issueUrl: issue.html_url })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
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

async function createBotTaskIssue(env: Env, req: ValidatedRequest): Promise<GhIssue> {
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
