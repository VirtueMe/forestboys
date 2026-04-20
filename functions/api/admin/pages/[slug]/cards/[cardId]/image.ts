/**
 * POST /api/admin/pages/:slug/cards/:cardId/image — upload a hero image for a Card.
 *
 * Multipart: field `file` is the image blob. Admin role required.
 * Stores to R2 at cards/{cardId}-{timestamp}.{ext}, then updates the existing
 * Source node's url (or creates Source + HAS_HERO_IMAGE edge if missing).
 * Responds with { url: "/images/..." }.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
  IMAGES:         R2Bucket
}

interface UrlRow {
  url: string
}

/**
 * Minimal File-ish shape — @cloudflare/workers-types doesn't include the DOM
 * File globally, so we type-narrow against the properties we actually use.
 */
interface UploadedFile {
  size:   number
  type:   string
  stream: () => ReadableStream
}

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const EXT_BY_MIME: Record<string, string> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif':  'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug   = String(params.slug)
  const cardId = String(params.cardId)
  if (!cardId.startsWith(`card:${slug}:`)) {
    return json({ error: `Bad card id for page ${slug}: ${cardId}` }, 400)
  }

  let form: FormData
  try { form = await request.formData() } catch { return json({ error: 'Invalid multipart body' }, 400) }

  const entry = form.get('file') as unknown
  if (!entry || typeof entry === 'string' || typeof (entry as UploadedFile).size !== 'number') {
    return json({ error: 'Missing "file" field' }, 400)
  }
  const file = entry as UploadedFile
  if (file.size > MAX_BYTES) return json({ error: `File too large (${file.size} > ${MAX_BYTES})` }, 413)
  const ext = EXT_BY_MIME[file.type]
  if (!ext) return json({ error: `Unsupported type: ${file.type}` }, 415)

  const key = `cards/${cardId}-${Date.now()}.${ext}`
  await env.IMAGES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  })
  const url = `/images/${key}`

  try {
    const rows = await runCypher<UrlRow>(env, `
      MATCH (p:Page {slug: $slug})-[:HAS_CARD]->(c:Card {id: $cardId})
      OPTIONAL MATCH (c)-[:HAS_HERO_IMAGE]->(existing:Source)
      WITH c, existing
      FOREACH (_ IN CASE WHEN existing IS NULL THEN [1] ELSE [] END |
        CREATE (s:Source { id: "source:" + $cardId + ":hero", url: $url, kind: "upload" })
        CREATE (c)-[:HAS_HERO_IMAGE]->(s)
      )
      FOREACH (_ IN CASE WHEN existing IS NOT NULL THEN [1] ELSE [] END |
        SET existing.url  = $url,
            existing.kind = "upload"
      )
      WITH c
      MATCH (c)-[:HAS_HERO_IMAGE]->(s:Source)
      RETURN s.url AS url
    `, { slug, cardId, url })

    if (!rows.length) return json({ error: 'Card not found' }, 404)
    return json({ ok: true, url: rows[0].url })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
