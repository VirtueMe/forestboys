/**
 * An archived bundle (#188). Admin-session-gated.
 *
 *   GET    /api/admin/proposals/archive/<bundleId>    read-only: what the archive says, the manifest, the log, the comments
 *   DELETE /api/admin/proposals/archive/<bundleId>    purge for good, body `{ reason }`; a short record of who, when and why stays
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { actorOf, withCurrentNames } from '~/_lib/bundle-events.ts'
import { ArchiveError, purgeArchive, readArchive } from '~/_lib/bundle-archive.ts'
import { validateReason, type ArchiveSummary } from '../../../../../src/utils/bundleArchive.ts'
import type { BundleEvent } from '../../../../../src/utils/bundleEvents.ts'
import type { BundleComment } from '../../../../../src/utils/bundleComments.ts'

interface Env {
  SESSION_SECRET: string
  PROPOSALS:      R2Bucket
  milorg_users?:  D1Database
}

const BUNDLE_ID_RE = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = decodeURIComponent(String(params.bundleId))
  if (!BUNDLE_ID_RE.test(bundleId)) return json({ error: 'bundleId malformed' }, 400)

  try {
    const { objects, ...archive } = await readArchive(env.PROPOSALS, bundleId)
    const under = <T>(dir: string): T[] => Object.entries(objects).filter(([rel]) => rel.startsWith(dir)).sort(([a], [b]) => a.localeCompare(b)).map(([, o]) => o.value as T)
    const events   = under<Omit<BundleEvent, 'id'>>('events/').map((e, i) => ({ id: String(i), ...e }) as BundleEvent)
    const comments = under<BundleComment>('comments/')
    const named    = await withCurrentNames(env.milorg_users, [...events, ...comments])
    const [archivedBy] = await withCurrentNames(env.milorg_users, [{ actor: { id: archive.archivedById ?? '', name: archive.archivedBy } }])
    return json({
      archive:  { ...archive, archivedBy: 'name' in archivedBy.actor ? archivedBy.actor.name : archive.archivedBy } satisfies ArchiveSummary,
      manifest: objects['manifest.json']?.value ?? null,
      events:   named.slice(0, events.length),
      comments: named.slice(events.length),
    })
  } catch (e) {
    if (e instanceof ArchiveError) return json({ error: e.message }, e.status)
    return json({ error: (e as Error).message }, 502)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard
  if (!env.PROPOSALS) return json({ error: 'PROPOSALS R2 binding missing' }, 500)

  const bundleId = decodeURIComponent(String(params.bundleId))
  if (!BUNDLE_ID_RE.test(bundleId)) return json({ error: 'bundleId malformed' }, 400)
  const reason = validateReason(await request.json().catch(() => null))
  if (typeof reason !== 'string') return json(reason, 400)

  try {
    await purgeArchive(env.PROPOSALS, bundleId, actorOf(guard), reason)
    return json({ ok: true })
  } catch (e) {
    if (e instanceof ArchiveError) return json({ error: e.message }, e.status)
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
