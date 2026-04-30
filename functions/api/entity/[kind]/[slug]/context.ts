/**
 * GET /api/entity/<kind>/<slug>/context — bot-facing read endpoint.
 *
 * Feeds the bot-task workflow's `OUTLINE_JSON` + `LIVE_ENTITIES_JSON`
 * template variables (see `.github/workflows/bot-task.yml` and
 * `scripts/prompts/proposal-bundle.txt`).
 *
 *   - Outline kind: returns the outline body (descriptions with per-block
 *     shas + MENTIONS list) AND each mentioned entity's live state. The
 *     workflow splats `outline` into OUTLINE_JSON and `referencedEntities`
 *     into LIVE_ENTITIES_JSON.
 *   - Other kinds: returns just that entity's context under `entity`.
 *     Useful for spot-checks; not used by the bot today.
 *
 * Auth: `Authorization: Bearer ${BOT_INGEST_SECRET}` — re-uses the same
 * shared secret as the ingest HMAC. Constant-time compare.
 *
 * Per-block sha matches the one `functions/api/admin/proposals/_apply.ts`
 * recomputes at accept time, so a bot-emitted `expectedSha` taken from
 * here will pass drift detection for as long as the live block hasn't
 * changed.
 */

import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { stableSha } from '~/_lib/stable-sha.ts'

interface Env extends Neo4jEnv {
  BOT_INGEST_SECRET: string
}

const ENTITY_KINDS = new Set([
  'Person', 'Unit', 'Station', 'Transport',
  'Operation', 'Incident', 'Location', 'Outline', 'Organization',
])
const SLUG_RE = /^[a-z0-9-]+$/

interface BlockEntry {
  _key:  string
  sha:   string
  block: Record<string, unknown>
}

interface DescriptionEntry {
  descId: string
  order:  number
  blocks: BlockEntry[]
}

interface EntityContext {
  id:            string
  kind:          string
  slug:          string
  props:         Record<string, unknown>
  descriptions:  DescriptionEntry[]
  edges:         { type: string; to: string; props: Record<string, unknown> }[]
}

interface OutlineContext extends EntityContext {
  mentions: string[]
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!env.BOT_INGEST_SECRET) return json({ error: 'BOT_INGEST_SECRET not configured' }, 500)

  const auth = request.headers.get('Authorization') || ''
  if (!verifyBearer(auth, env.BOT_INGEST_SECRET)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const kind = String(params.kind)
  const slug = String(params.slug)
  if (!ENTITY_KINDS.has(kind))   return json({ error: `Unknown kind: ${kind}` }, 400)
  if (!SLUG_RE.test(slug))       return json({ error: `Invalid slug: ${slug}` }, 400)

  try {
    if (kind === 'Outline') {
      const outline = await loadOutlineContext(env, slug)
      if (!outline) return json({ error: `Outline:${slug} not found` }, 404)
      const referencedEntities = await loadMentionedEntities(env, slug)
      return json({ kind: 'Outline', outline, referencedEntities })
    }

    const entity = await loadEntityContext(env, kind, slug)
    if (!entity) return json({ error: `${kind}:${slug} not found` }, 404)
    return json({ kind, entity })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function verifyBearer(header: string, expected: string): boolean {
  const prefix = 'Bearer '
  if (!header.startsWith(prefix)) return false
  const got = header.slice(prefix.length)
  if (got.length !== expected.length) return false
  let mismatch = 0
  for (let i = 0; i < got.length; i++) mismatch |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return mismatch === 0
}

async function loadOutlineContext(env: Env, slug: string): Promise<OutlineContext | null> {
  const base = await loadEntityContext(env, 'Outline', slug)
  if (!base) return null

  const mentionRows = await runCypher<{ kind: string; slug: string }>(
    env,
    `MATCH (o:Outline {slug: $slug})-[:MENTIONS]->(t)
     RETURN head(labels(t)) AS kind, t.slug AS slug
     ORDER BY kind, slug`,
    { slug },
  )
  const mentions = mentionRows
    .filter((r) => r.kind && r.slug && ENTITY_KINDS.has(r.kind))
    .map((r) => `${r.kind}:${r.slug}`)

  return { ...base, mentions }
}

async function loadMentionedEntities(env: Env, outlineSlug: string): Promise<EntityContext[]> {
  const rows = await runCypher<{ kind: string; slug: string }>(
    env,
    `MATCH (o:Outline {slug: $slug})-[:MENTIONS]->(t)
     RETURN head(labels(t)) AS kind, t.slug AS slug`,
    { slug: outlineSlug },
  )

  const out: EntityContext[] = []
  for (const r of rows) {
    if (!r.kind || !r.slug || !ENTITY_KINDS.has(r.kind)) continue
    const ctx = await loadEntityContext(env, r.kind, r.slug)
    if (ctx) out.push(ctx)
  }
  return out
}

async function loadEntityContext(env: Env, kind: string, slug: string): Promise<EntityContext | null> {
  // Core node + properties.
  const nodeRows = await runCypher<{ props: Record<string, unknown> }>(
    env,
    `MATCH (n:\`${kind}\` {slug: $slug}) RETURN properties(n) AS props`,
    { slug },
  )
  if (!nodeRows.length) return null
  const props = nodeRows[0].props || {}

  // Descriptions, ordered.
  const descRows = await runCypher<{ descId: string; order: number | null; content: string | null }>(
    env,
    `MATCH (n:\`${kind}\` {slug: $slug})-[:HAS_CONTENT]->(d:Description)
     RETURN d.id AS descId, d.order AS order, d.content AS content
     ORDER BY coalesce(d.order, 9999) ASC, d.id ASC`,
    { slug },
  )

  const descriptions: DescriptionEntry[] = []
  for (const row of descRows) {
    if (!row.content) continue
    let blocks: unknown[]
    try {
      blocks = JSON.parse(row.content) as unknown[]
    } catch {
      continue
    }
    if (!Array.isArray(blocks)) continue

    const blockEntries: BlockEntry[] = []
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue
      const bb = b as Record<string, unknown>
      if (typeof bb._key !== 'string') continue
      const sha = await stableSha(bb)
      blockEntries.push({ _key: bb._key, sha, block: bb })
    }

    descriptions.push({
      descId: row.descId,
      order:  row.order ?? 1,
      blocks: blockEntries,
    })
  }

  // Outbound edges — every relationship the entity has, with target entityId
  // resolved to `<Kind>:<slug>` when the target carries a slug + an entity
  // label. Edges to nodes outside ENTITY_KINDS (Description, Source, …) are
  // dropped: the bot can't reference them in proposal ops anyway.
  const edgeRows = await runCypher<{ type: string; toKind: string | null; toSlug: string | null; props: Record<string, unknown> }>(
    env,
    `MATCH (n:\`${kind}\` {slug: $slug})-[r]->(t)
     WHERE t.slug IS NOT NULL
     RETURN type(r) AS type, head(labels(t)) AS toKind, t.slug AS toSlug, properties(r) AS props
     ORDER BY type, toKind, toSlug`,
    { slug },
  )
  const edges = edgeRows
    .filter((r) => r.toKind && r.toSlug && ENTITY_KINDS.has(r.toKind))
    .map((r) => ({ type: r.type, to: `${r.toKind}:${r.toSlug}`, props: r.props || {} }))

  return {
    id: `${kind}:${slug}`,
    kind,
    slug,
    props,
    descriptions,
    edges,
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
