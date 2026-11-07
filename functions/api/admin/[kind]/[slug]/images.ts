/**
 * The photos of one entity (HAS_IMAGE), for every kind (#414, epic #405).
 *
 * GET    /api/admin/<kind>/<slug>/images   — the entity's own photos, in gallery order
 * POST   /api/admin/<kind>/<slug>/images   — multipart: `file`, optional `caption`, `license`, `attribution`
 * PATCH  /api/admin/<kind>/<slug>/images   — { order?: id[], hero?: id | null, captions?: { [id]: string | null } }
 * DELETE /api/admin/<kind>/<slug>/images   — { id }: removes the edge only
 *
 * Only the entity's own edges are touched; photos a page shows from its operations, units or
 * organisations belong to those. A removed edge leaves the Source and the files: an id is a
 * content hash and the same photo can hang on another entity (a clean-up of unreferenced files
 * is a separate, explicit step). Uploads go through the shared door (`storeImage`, #408).
 * Editors and admins.
 */

import { requireEditor } from '~/_lib/require-editor.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { validateImage } from '~/_lib/images.ts'
import { ImageRefused, storeImage } from '~/_lib/store-image.ts'
import { remoteImageMaker, type MakerService } from '~/_lib/worker-image-maker.ts'
import {
  addImageQuery, entityExistsQuery, labelExpr, listImagesQuery, removeImageQuery, setCaptionsQuery, setHeroQuery, setOrderQuery,
  type OwnImage,
} from '~/_lib/entity-images.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
  IMAGES:         R2Bucket
  IMAGE_MAKER:    MakerService
}

/** The URL segment → the graph label. Every one is keyed by `slug`. */
const KIND_LABEL: Record<string, string> = {
  person: labelExpr('Person'), unit: labelExpr('Unit'), station: labelExpr('Station'), transport: labelExpr('Transport'),
  event: labelExpr('Operation', 'Incident'), location: labelExpr('Location'),
  outline: labelExpr('Outline'), organization: labelExpr('Organization'),
}

const SLUG_RE    = /^[a-z0-9-]+$/
const MAX_BYTES  = 10 * 1024 * 1024
const MAX_CAPTION = 1000
const LICENSE_RE = /^[A-Za-z0-9 .+\-()]{1,120}$/
const REFUSAL_STATUS = { 'empty': 400, 'too-large': 413, 'unsupported-type': 415 } as const

interface UploadedFile {
  size:        number
  type:        string
  arrayBuffer: () => Promise<ArrayBuffer>
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const g = await guard(request, env, params)
  if ('response' in g) return g.response
  try {
    return json({ images: await list(env, g.label, g.slug) })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const g = await guard(request, env, params)
  if ('response' in g) return g.response
  const { label, slug } = g

  let form: FormData
  try { form = await request.formData() } catch { return json({ error: 'Invalid multipart body' }, 400) }

  const entry = form.get('file') as unknown
  if (!entry || typeof entry === 'string' || typeof (entry as UploadedFile).size !== 'number') {
    return json({ error: 'Missing "file" field' }, 400)
  }
  const file = entry as UploadedFile
  if (file.size > MAX_BYTES) return json({ error: `File too large (${file.size} > ${MAX_BYTES})` }, 413)

  const caption     = text(form.get('caption'), MAX_CAPTION)
  const attribution = text(form.get('attribution'), MAX_CAPTION)
  const licenseRaw  = text(form.get('license'), 120)
  if (licenseRaw && !LICENSE_RE.test(licenseRaw)) return json({ error: 'Bad licence' }, 400)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const checked = validateImage(bytes, { maxBytes: MAX_BYTES })
  if (!checked.ok) return refused(checked.reason, file)
  if (!env.IMAGE_MAKER) return json({ error: 'Service binding IMAGE_MAKER is not configured' }, 503)

  // The entity first, so a missing one stores nothing (#404).
  try {
    const found = await runCypher<{ n: number }>(env, entityExistsQuery(label), { slug })
    if (!found.length) return json({ error: 'Not found' }, 404)
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }

  let id: string, url: string
  try {
    ;({ id, url } = await storeImage(env.IMAGES, bytes, { maxBytes: MAX_BYTES, maker: remoteImageMaker(env.IMAGE_MAKER) }))
  } catch (e) {
    if (e instanceof ImageRefused) return refused(e.reason, file)
    return json({ error: `Image could not be stored: ${(e as Error).message}` }, 502)
  }

  try {
    // The same photo on the same entity twice is one edge. The first photo of an entity is its hero.
    await runCypher(env, addImageQuery(label), { slug, sourceId: `img:upload:${id}`, url, license: licenseRaw, attribution, caption })
    return json({ ok: true, images: await list(env, label, slug) })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

interface PatchBody {
  order?:    unknown
  hero?:     unknown
  captions?: unknown
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const g = await guard(request, env, params)
  if ('response' in g) return g.response
  const { label, slug } = g

  const body = await request.json<PatchBody>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  let order: string[] | undefined
  if (body.order !== undefined) {
    if (!Array.isArray(body.order) || body.order.some(i => typeof i !== 'string')) return json({ error: 'order must be a list of ids' }, 400)
    order = body.order as string[]
    if (new Set(order).size !== order.length) return json({ error: 'order has a repeated id' }, 400)
  }
  let captions: [string, string | null][] | undefined
  if (body.captions !== undefined) {
    if (!body.captions || typeof body.captions !== 'object' || Array.isArray(body.captions)) return json({ error: 'captions must be an object' }, 400)
    captions = []
    for (const [id, v] of Object.entries(body.captions)) {
      if (v !== null && typeof v !== 'string') return json({ error: 'a caption is text or null' }, 400)
      captions.push([id, v === null ? null : (v.trim().slice(0, MAX_CAPTION) || null)])
    }
  }
  if (body.hero !== undefined && body.hero !== null && typeof body.hero !== 'string') return json({ error: 'hero is an id or null' }, 400)

  try {
    const have = new Set((await list(env, label, slug)).map(i => i.id))
    const unknown = [...(order ?? []), ...(captions ?? []).map(c => c[0]), ...(typeof body.hero === 'string' ? [body.hero] : [])]
      .find(id => !have.has(id))
    if (unknown !== undefined) return json({ error: `Not a photo of this entity: ${unknown}` }, 400)

    if (order) {
      // The listed ones first, in the given order; any left out keep their relative place after them.
      const rest = [...have].filter(id => !order.includes(id))
      await runCypher(env, setOrderQuery(label), { slug, ids: [...order, ...rest] })
    }
    if (captions?.length) {
      await runCypher(env, setCaptionsQuery(label), { slug, caps: captions })
    }
    if (body.hero !== undefined) {
      await runCypher(env, setHeroQuery(label), { slug, hero: body.hero })
    }
    return json({ ok: true, images: await list(env, label, slug) })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const g = await guard(request, env, params)
  if ('response' in g) return g.response
  const { label, slug } = g

  const body = await request.json<{ id?: unknown }>().catch(() => null)
  if (!body || typeof body.id !== 'string') return json({ error: 'id is required' }, 400)

  try {
    const gone = await runCypher<{ n: number }>(env, removeImageQuery(label), { slug, id: body.id })
    if (!gone.length) return json({ error: 'Not a photo of this entity' }, 404)
    return json({ ok: true, images: await list(env, label, slug) })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

async function list(env: Neo4jEnv, label: string, slug: string): Promise<OwnImage[]> {
  return runCypher<OwnImage>(env, listImagesQuery(label), { slug })
}

async function guard(
  request: Request, env: Env, params: Record<string, string | string[]>,
): Promise<{ label: string, slug: string } | { response: Response }> {
  const user = await requireEditor(request, env)
  if (user instanceof Response) return { response: user }
  const label = KIND_LABEL[String(params.kind)]
  const slug = String(params.slug)
  if (!label) return { response: json({ error: `Unknown kind: ${String(params.kind)}` }, 404) }
  if (!SLUG_RE.test(slug)) return { response: json({ error: 'Bad slug' }, 400) }
  return { label, slug }
}

function text(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
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
