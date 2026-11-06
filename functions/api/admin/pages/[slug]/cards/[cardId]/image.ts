/**
 * POST /api/admin/pages/:slug/cards/:cardId/image — upload a hero image for a Card.
 *
 * Multipart: field `file` is the image blob. Admin role required.
 * The file goes through the shared door (`storeImage`, #408): the type is read from the bytes,
 * a master and two WebP sizes are stored under the content hash, and the url is `/images/<id>`.
 * Then the existing Source node's url is updated (or Source + HAS_HERO_IMAGE edge created if
 * missing). Responds with { url: "/images/<id>" }.
 *
 * The card is looked up before anything is stored, so a card that does not exist (404) leaves
 * nothing in the bucket (#404). The key is the content hash, so the same file twice is one set
 * of objects, and what a failed save leaves is a complete image a retry reuses. A replaced
 * image is kept: an id is a content hash and the same photo can be on another card.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { validateImage } from '~/_lib/images.ts'
import { ImageRefused, storeImage } from '~/_lib/store-image.ts'
import { remoteImageMaker, type MakerService } from '~/_lib/worker-image-maker.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET:  string
  IMAGES:          R2Bucket
  /** Service binding to the `milorg-image-maker` worker, which holds the Cloudflare Images binding and makes the display sizes. */
  IMAGE_MAKER:     MakerService
}

interface UrlRow {
  url: string
}

/**
 * Minimal File-ish shape — @cloudflare/workers-types doesn't include the DOM
 * File globally, so we type-narrow against the properties we actually use.
 */
interface UploadedFile {
  size:        number
  type:        string
  arrayBuffer: () => Promise<ArrayBuffer>
}

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const REFUSAL_STATUS = { 'empty': 400, 'too-large': 413, 'unsupported-type': 415 } as const

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  // The client sends the card id with encodeURIComponent ("card:home:1" -> "card%3Ahome%3A1"), and the params arrive as sent.
  let slug: string, cardId: string
  try {
    slug   = decodeURIComponent(String(params.slug))
    cardId = decodeURIComponent(String(params.cardId))
  } catch {
    return json({ error: 'Bad card id' }, 400)
  }
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

  const bytes = new Uint8Array(await file.arrayBuffer())
  const checked = validateImage(bytes, { maxBytes: MAX_BYTES })
  if (!checked.ok) return refused(checked.reason, file)
  if (!env.IMAGE_MAKER) return json({ error: 'Service binding IMAGE_MAKER is not configured' }, 503)

  // The card first, so a missing one stores nothing (#404).
  try {
    const found = await runCypher<{ id: string }>(env, `
      MATCH (:Page {slug: $slug})-[:HAS_CARD]->(c:Card {id: $cardId}) RETURN c.id AS id
    `, { slug, cardId })
    if (!found.length) return json({ error: 'Card not found' }, 404)
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }

  let url: string
  try {
    ;({ url } = await storeImage(env.IMAGES, bytes, { maxBytes: MAX_BYTES, maker: remoteImageMaker(env.IMAGE_MAKER) }))
  } catch (e) {
    if (e instanceof ImageRefused) return refused(e.reason, file)
    return json({ error: `Image could not be stored: ${(e as Error).message}` }, 502)
  }

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

function refused(reason: keyof typeof REFUSAL_STATUS, file: UploadedFile): Response {
  const error = {
    'empty':            'Empty file',
    'too-large':        `File too large (${file.size} > ${MAX_BYTES})`,
    'unsupported-type': `Unsupported type: ${file.type}`,
  }[reason]
  return json({ error }, REFUSAL_STATUS[reason])
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
