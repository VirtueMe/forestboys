/**
 * POST /api/admin/outline/:slug/rename — change an outline's slug (#456), on `renameSlug` (#96): the old address keeps
 * working, links to it are rewritten, and what the outline produced follows.
 *
 * Body: { slug: string }  →  { ok, slug, descriptions, links, skipped }
 * 409 when the slug is taken, or a bundle or bot job is open for the outline.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { invalidateSitemap, type SitemapBinding } from '~/_lib/sitemap.ts'
import { renameSlug } from '~/_lib/slug-rename.ts'
import { outlineRenameBlock } from '~/_lib/outline-rename.ts'

interface Env extends Neo4jEnv, SitemapBinding {
  SESSION_SECRET: string
  PROPOSALS?:     R2Bucket
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)
  const from = String(params.slug)
  const body = await request.json<{ slug?: unknown }>().catch(() => null)
  if (!body || typeof body.slug !== 'string') return json({ error: 'slug required' }, 400)

  try {
    const blocked = await outlineRenameBlock(env.PROPOSALS, from)
    if (blocked) return json({ error: blocked }, 409)
    const r = await renameSlug(env, { label: 'Outline', from, to: body.slug })
    if ('error' in r) return json({ error: r.error }, r.status)
    waitUntil(invalidateSitemap(env))
    return json({ ok: true, slug: r.to, descriptions: r.descriptions, links: r.links, skipped: r.skipped })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
