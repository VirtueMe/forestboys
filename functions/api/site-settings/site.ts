/**
 * GET /api/site-settings/site — public. The site's name and short name, for the
 * nav, the tab title and the manifest. Defaults when nothing is saved.
 */

import { readSiteSettings } from '~/_lib/site-settings.ts'

interface Env { milorg_users?: D1Database }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const settings = await readSiteSettings(env.milorg_users)
  return new Response(JSON.stringify(settings), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
