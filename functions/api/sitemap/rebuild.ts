/**
 * POST /api/sitemap/rebuild — rebuild the list of pages from the graph now (#220).
 *
 * For writes that bypass the admin endpoints and so cannot call `invalidateSitemap` themselves: the Sanity sync and the
 * migration scripts run against Neo4j directly, with no access to the KV binding. They sign the (empty) body with
 * `BOT_INGEST_SECRET`, as the bot does for ingest. The rebuild is awaited, so the caller sees a failure.
 */

import { verifyHmac } from '~/_lib/hmac.ts'
import { buildSitemap, type SitemapEnv } from '~/_lib/sitemap.ts'

interface Env extends SitemapEnv { BOT_INGEST_SECRET?: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.BOT_INGEST_SECRET) return json({ error: 'BOT_INGEST_SECRET not configured' }, 500)
  const ok = await verifyHmac(await request.arrayBuffer(), request.headers.get('X-Hub-Signature-256') || '', env.BOT_INGEST_SECRET)
  if (!ok) return json({ error: 'Invalid signature' }, 401)

  try {
    const paths = await buildSitemap(env)
    return json({ ok: true, urls: paths.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
