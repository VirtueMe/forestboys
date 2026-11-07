/**
 * POST /api/admin/outline/new — create an Outline: a document that waits in the inbox for a bundle to be made from
 * it (#433). Body `{ slug, canonicalName }`; returns `{ ok, slug }` so the client can open /outlines/:slug and write
 * the text there (the sections, photos and people have their own endpoints).
 *
 * The URL slug is always the sentinel `new`; the real slug comes from the body. The node has no `sanityId`, and that is
 * what marks it as made here: every outline sync matches on `sanityId`, so none of them updates it or reports it as
 * gone. A Sanity outline that arrives later with the same slug is an error in the sync's report, never an overwrite
 * (docs/SANITY-SYNC.md, «Outlines»).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { invalidateSitemap, type SitemapBinding } from '~/_lib/sitemap.ts'
import { slugClaim, aliasTakenMessage, SLUG_RE } from '~/_lib/slug-alias.ts'

interface Env extends Neo4jEnv, SitemapBinding { SESSION_SECRET: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (String(params.slug) !== 'new') return json({ error: 'POST requires URL slug "new"' }, 400)

  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const { slug } = body
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return json({ error: 'slug må være små bokstaver, tall og bindestrek' }, 400)
  if (slug === 'new') return json({ error: 'slug "new" er reservert' }, 400)
  const name = typeof body.canonicalName === 'string' ? body.canonicalName.trim() : ''
  if (!name) return json({ error: 'canonicalName må være en tekst' }, 400)

  try {
    const claim = await slugClaim(env, '/outlines/', slug)
    if (claim === 'live')  return json({ error: `Slug finnes allerede for en informasjonsside: ${slug}` }, 409)
    if (claim === 'alias') return json({ error: aliasTakenMessage(slug) }, 409)

    await runCypher(env, `CREATE (o:Outline {slug: $slug, canonicalName: $name})`, { slug, name })
    waitUntil(invalidateSitemap(env))
    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
