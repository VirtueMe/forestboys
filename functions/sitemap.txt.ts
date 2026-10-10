/**
 * GET /sitemap.txt — every public page, one absolute URL per line (#220). Read from KV (`_lib/sitemap.ts`), so it is
 * as current as the last write that changed the set of URLs. 503 when there is no list and none can be built: a
 * partial sitemap would tell search engines the rest does not exist.
 */

import { readSitemap, renderSitemap, type SitemapEnv } from '~/_lib/sitemap.ts'

export const onRequestGet: PagesFunction<SitemapEnv> = async ({ request, env, waitUntil }) => {
  const sitemap = await readSitemap(env, waitUntil)
  if (!sitemap) return new Response('Sitemap unavailable\n', { status: 503, headers: { 'Retry-After': '60', 'Content-Type': 'text/plain; charset=utf-8' } })
  return new Response(renderSitemap(sitemap.paths, new URL(request.url).origin), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
}

// A HEAD request does not reach onRequestGet (seen under `pages dev`): `curl -I` got the app's index.html.
export const onRequestHead = onRequestGet
