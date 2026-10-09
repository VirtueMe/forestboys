/**
 * Pages Functions root middleware. Puts the site's name (an admin setting, #153) into the
 * `<title>` of the HTML it serves, so the tab, search results and link previews have it
 * without the app running. The BundleEventsDO durable object lives in the sibling Worker
 * `workers/bundle-events/` (Pages can't host DO classes itself), bound here via
 * `script_name` in wrangler.toml.
 */

import { readSiteSettings } from '~/_lib/site-settings.ts'

interface Env { milorg_users?: D1Database }

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const res = await ctx.next()
  if (!res.headers.get('Content-Type')?.includes('text/html')) return res

  const { name } = await readSiteSettings(ctx.env.milorg_users)
  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(name) } })
    .transform(res)
}
