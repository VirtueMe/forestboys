/**
 * GET /api/site-settings/changelog — public. How many releases the changelog
 * page shows up front and per "Vis flere". Defaults when nothing is saved.
 */

import { readChangelogSettings } from '~/_lib/site-settings.ts'

interface Env { milorg_users?: D1Database }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const settings = await readChangelogSettings(env.milorg_users)
  return new Response(JSON.stringify(settings), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
