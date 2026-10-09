/**
 * GET /manifest.json — the web app manifest, served from the site-name setting.
 * It replaces public/manifest.json: a static file there would win over this function.
 * An installed app re-reads the manifest only now and then, so a rename reaches it late.
 */

import { buildManifest } from '~/_lib/manifest.ts'
import { readSiteSettings } from '~/_lib/site-settings.ts'

interface Env { milorg_users?: D1Database }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const manifest = buildManifest(await readSiteSettings(env.milorg_users))
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' },
  })
}
