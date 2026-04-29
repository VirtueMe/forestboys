/**
 * GET /api/admin/<kind>/<slug>/proposals          — full pending proposals
 * GET /api/admin/<kind>/<slug>/proposals?count=true — just the marker-badge count
 *
 * Reads R2 PROPOSALS bucket: index.json + per-block files for the entity.
 *
 * v1 limitation: NO drift filtering yet. The endpoint returns whatever is
 * stored — drift detection (compare expectedSha vs current Neo4j PT-block
 * sha) lands in a follow-up once the Description+block lookup helpers exist.
 *
 * Admin-session-gated. Used by the marker-badge composable + diff panel.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
}

const ENTITY_KINDS = new Set([
  'Person', 'Unit', 'Station', 'Transport',
  'Operation', 'Incident', 'Location', 'Outline',
])
const SLUG_RE = /^[a-z0-9-]+$/

interface IndexEntry {
  blockPath:   string
  source:      string
  generatedAt: string
}

interface ProposalIndex {
  entityId: string
  blocks:   IndexEntry[]
}

interface ProposalBody {
  entityId:    string
  blockPath:   string
  expectedSha: string
  newValue:    unknown
  derivedFrom: { outlineId: string; sectionPath: string; outlineRev: string }
  source:      string
  model:       string
  generatedAt: string
  promptHash:  string
  aiGenerated: boolean
  conflict:    boolean
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const kind = String(params.kind)
  const slug = String(params.slug)
  if (!ENTITY_KINDS.has(kind))   return json({ error: `Unknown kind: ${kind}` }, 400)
  if (!SLUG_RE.test(slug))       return json({ error: 'slug must match /^[a-z0-9-]+$/' }, 400)

  const entityId = `${kind}:${slug}`
  const url      = new URL(request.url)
  const countOnly = url.searchParams.get('count') === 'true'

  try {
    const indexObj = await env.PROPOSALS.get(`proposals/${entityId}/index.json`)
    if (!indexObj) {
      return countOnly
        ? json({ pendingCount: 0 })
        : json({ entityId, blocks: [] })
    }

    const index = await indexObj.json<ProposalIndex>()

    if (countOnly) return json({ pendingCount: index.blocks.length })

    const blocks = await Promise.all(
      index.blocks.map(async (entry) => {
        const obj = await env.PROPOSALS.get(`proposals/${entityId}/${encodePathComponent(entry.blockPath)}.json`)
        if (!obj) return null  // index referenced a missing file — drop silently
        return await obj.json<ProposalBody>()
      }),
    )

    return json({
      entityId,
      blocks: blocks.filter((b): b is ProposalBody => b !== null),
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function encodePathComponent(s: string): string {
  return s.replace(/\//g, '_')
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
