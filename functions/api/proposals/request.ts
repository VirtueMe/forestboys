/**
 * POST /api/proposals/request — request a Claude-generated proposal for one
 * Portable Text block. Creates a `bot-task` GitHub issue carrying the JSON
 * contract from .github/ISSUE_TEMPLATE/bot-task.md; the Action picks it up,
 * runs Claude, and POSTs the result to /api/proposals/ingest.
 *
 * Admin-session-gated. The endpoint itself is fast — issue creation is the
 * only side effect — but the resulting bot work is async (minutes).
 *
 * Body: see ProposalRequest below. Returns {issueNumber, issueUrl}.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'

interface Env {
  SESSION_SECRET: string
  GITHUB_TOKEN:   string  // PAT with `issues:write` on the milorg repo
  GITHUB_REPO:    string  // "<owner>/<repo>", e.g. "motstandsbevegelsen/milorg"
}

const ENTITY_KINDS = new Set([
  'Person', 'Unit', 'Station', 'Transport',
  'Operation', 'Incident', 'Location', 'Outline',
])

const SLUG_RE        = /^[a-z0-9-]+$/
const BLOCK_PATH_RE  = /^section\.[a-z0-9-]+\.block\.[A-Za-z0-9_-]+$/
const PROMPT_HASH_RE = /^[a-f0-9]{12}$/

interface ProposalRequest {
  entityId:    unknown
  kind:        unknown
  slug:        unknown
  blockPath:   unknown
  outlineId:   unknown
  outlineRev:  unknown
  sectionPath: unknown
  promptHash:  unknown
}

interface ValidatedRequest {
  entityId:    string
  kind:        string
  slug:        string
  blockPath:   string
  outlineId:   string
  outlineRev:  string
  sectionPath: string
  promptHash:  string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return json({ error: 'GITHUB_TOKEN / GITHUB_REPO not configured' }, 500)
  }

  const body = await request.json<ProposalRequest>().catch(() => null)
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

function validate(b: ProposalRequest): ValidatedRequest | string {
  if (typeof b.kind !== 'string' || !ENTITY_KINDS.has(b.kind)) {
    return `kind must be one of: ${[...ENTITY_KINDS].join(', ')}`
  }
  if (typeof b.slug !== 'string' || !SLUG_RE.test(b.slug)) {
    return 'slug must match /^[a-z0-9-]+$/'
  }
  if (typeof b.entityId !== 'string' || b.entityId !== `${b.kind}:${b.slug}`) {
    return 'entityId must equal `<kind>:<slug>` and match the kind/slug fields'
  }
  if (typeof b.blockPath !== 'string' || !BLOCK_PATH_RE.test(b.blockPath)) {
    return 'blockPath must match `section.<slug>.block.<key>`'
  }
  if (typeof b.outlineId !== 'string' || !SLUG_RE.test(b.outlineId)) {
    return 'outlineId must match /^[a-z0-9-]+$/'
  }
  if (typeof b.outlineRev !== 'string' || !b.outlineRev.trim()) {
    return 'outlineRev must be a non-empty string'
  }
  if (typeof b.sectionPath !== 'string' || !b.sectionPath.trim()) {
    return 'sectionPath must be a non-empty string'
  }
  if (typeof b.promptHash !== 'string' || !PROMPT_HASH_RE.test(b.promptHash)) {
    return 'promptHash must be 12 lowercase hex chars'
  }
  return {
    entityId:    b.entityId,
    kind:        b.kind,
    slug:        b.slug,
    blockPath:   b.blockPath,
    outlineId:   b.outlineId,
    outlineRev:  b.outlineRev.trim(),
    sectionPath: b.sectionPath.trim(),
    promptHash:  b.promptHash,
  }
}

interface GhIssue {
  number:    number
  html_url:  string
}

async function createBotTaskIssue(env: Env, req: ValidatedRequest): Promise<GhIssue> {
  const title = `bot-task: ${req.kind} ${req.entityId} / outline ${req.outlineId} §${req.sectionPath}`
  const body  = renderIssueBody(req)
  const labels = ['bot-task', `outline:${req.outlineId}`, `kind:${req.kind}`]

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
  // request payload — additional prose is fine.
  const payload = JSON.stringify(req, null, 2)
  return [
    '<!-- Auto-created by /api/proposals/request. Do not edit by hand. -->',
    '',
    '## Request',
    '',
    '```json',
    payload,
    '```',
    '',
    '## Re-running',
    '',
    'Edit-and-save (or re-add the `bot-task` label) to re-trigger the Action.',
    'The proposal file in R2 will be overwritten — newest wins.',
  ].join('\n')
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
