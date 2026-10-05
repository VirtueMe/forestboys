/**
 * /api/admin/site-settings/changelog — admin only.
 * GET → { initial, step } (defaults when unsaved).
 * PUT { initial, step } → saves both; each a whole number from 1 to 100.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { parseChangelogSettings, readChangelogSettings, writeChangelogSettings } from '~/_lib/site-settings.ts'

interface Env {
  SESSION_SECRET: string
  milorg_users:   D1Database
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  return json(await readChangelogSettings(env.milorg_users))
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const parsed = parseChangelogSettings(await request.json().catch(() => null))
  if (!parsed.ok) return json({ error: parsed.error }, 400)

  try {
    await writeChangelogSettings(env.milorg_users, parsed.value)
    return json(parsed.value)
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
