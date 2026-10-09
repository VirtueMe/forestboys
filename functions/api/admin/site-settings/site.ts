/**
 * /api/admin/site-settings/site — admin only.
 * GET → { name, shortName } (defaults when unsaved).
 * PUT { name, shortName } → saves both; trimmed, not empty, 60 and 24 characters at most.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { parseSiteSettings, readSiteSettings, writeSiteSettings } from '~/_lib/site-settings.ts'

interface Env {
  SESSION_SECRET: string
  milorg_users:   D1Database
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  return json(await readSiteSettings(env.milorg_users))
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const parsed = parseSiteSettings(await request.json().catch(() => null))
  if (!parsed.ok) return json({ error: parsed.error }, 400)

  try {
    await writeSiteSettings(env.milorg_users, parsed.value)
    return json(parsed.value)
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
