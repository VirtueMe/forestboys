/**
 * Pages Functions root middleware. Two jobs.
 *
 * 1. Real status codes (#220). The app is a single-page app, so an entity address (`/person/linge`) is `index.html`
 *    whatever the slug. Crawlers, link previews and archives read the status, so a page that exists answers 200 and
 *    one that does not answers 404 — with the same `index.html`, so the app still renders (`NotFoundView`). «Exists»
 *    is the KV list in `_lib/sitemap.ts`. When there is no list and none can be built, the answer is 200: a wrong 404
 *    hides a real page, a wrong 200 is what the site did before.
 * 2. Puts the site's name (an admin setting, #153) into the `<title>` of the HTML it serves, so the tab, search results
 *    and link previews have it without the app running.
 *
 * The BundleEventsDO durable object lives in the sibling Worker `workers/bundle-events/` (Pages can't host DO classes
 * itself), bound here via `script_name` in wrangler.toml.
 */

import { readSiteSettings } from '~/_lib/site-settings.ts'
import { entityPath, pageStatus, readSitemap, type SitemapEnv } from '~/_lib/sitemap.ts'

interface Env extends SitemapEnv {
  milorg_users?: D1Database
  ASSETS:        Fetcher
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  const isPage = (ctx.request.method === 'GET' || ctx.request.method === 'HEAD')
    && !url.pathname.split('/').pop()!.includes('.')
    && entityPath(url.pathname) !== null

  let res: Response
  if (isPage) {
    const status = pageStatus(url.pathname, await readSitemap(ctx.env, ctx.waitUntil.bind(ctx)))
    // The shell itself, not what the static host would answer for this path (its 404 page, while there is one).
    const shell = await ctx.env.ASSETS.fetch(new Request(new URL('/', url), { headers: ctx.request.headers }))
    res = new Response(shell.body, { status: shell.ok ? status : shell.status, headers: shell.headers })
  } else {
    res = await ctx.next()
  }
  if (!res.headers.get('Content-Type')?.includes('text/html')) return res

  const { name } = await readSiteSettings(ctx.env.milorg_users)
  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(name) } })
    .transform(res)
}
