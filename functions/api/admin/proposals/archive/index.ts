/**
 * GET /api/admin/proposals/archive — the archived bundles (#188), newest archived first. One listing with the objects' custom
 * metadata: no archived bundle is read. Admin-session-gated.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { listArchive } from '~/_lib/bundle-archive.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
  milorg_users?:  D1Database
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)
  try {
    return json({ bundles: await refreshNames(env.milorg_users, await listArchive(env.PROPOSALS)) })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

/** Who archived it, by the name they have now (the row keeps the id). */
async function refreshNames<T extends { archivedBy: string; archivedById?: string }>(db: D1Database | undefined, rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.flatMap(r => (r.archivedById ? [r.archivedById] : [])))]
  if (!db || !ids.length) return rows
  try {
    const { results } = await db.prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; name: string | null }>()
    const names = new Map(results.filter(r => r.name).map(r => [r.id, r.name as string]))
    return rows.map(r => (r.archivedById && names.has(r.archivedById) ? { ...r, archivedBy: names.get(r.archivedById)! } : r))
  } catch (e) {
    console.error('archive names not refreshed:', (e as Error).message)
    return rows
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
