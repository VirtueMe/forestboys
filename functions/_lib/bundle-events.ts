/**
 * A bundle's event log in R2 (#190): one object per event, `proposals/bundles/<id>/events/<at>-<kind>-<rand>.json`.
 * R2 has no append, so two editors acting at once write two objects and never collide; the name starts with the time, so
 * a listing returns them in order. docs/PROPOSALS.md, «Events». The shape and the text are in src/utils/bundleEvents.ts.
 *
 * Recording an event never fails the action it describes: the accept, the deny or the ingest has already happened, and
 * refusing the answer because the log could not be written would make the page say the opposite of the graph.
 */

import type { SessionUser } from './session.ts'
import { originKind, type BundleOriginFields } from './bundle-origin.ts'
import type { BundleEvent, BundleEventBody, EventActor } from '../../src/utils/bundleEvents.ts'

export const eventsPrefix = (bundleId: string) => `proposals/bundles/${bundleId}/events/`

/**
 * An event stores the user's id and the name they had at the time. The page shows the name they have now, so a name change
 * does not leave the old one in the history: names are read from the users table by id when the log is read. A user who is
 * gone, or no table to ask (local dev without D1), keeps the stored name.
 */
export async function withCurrentNames(db: D1Database | undefined, events: BundleEvent[]): Promise<BundleEvent[]> {
  const ids = [...new Set(events.flatMap(e => ('id' in e.actor && e.actor.id ? [e.actor.id] : [])))]
  if (!db || !ids.length) return events
  try {
    const { results } = await db
      .prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<{ id: string; name: string | null }>()
    const names = new Map(results.filter(r => r.name).map(r => [r.id, r.name as string]))
    return events.map(e => 'id' in e.actor && e.actor.id && names.has(e.actor.id) ? { ...e, actor: { ...e.actor, name: names.get(e.actor.id)! } } : e)
  } catch (err) {
    console.error('event names not refreshed:', (err as Error).message)
    return events
  }
}

/** The signed-in user, by name: the email stays out of the log and the page. */
export function actorOf(user: SessionUser): EventActor {
  return { id: user.id, name: user.name || 'ukjent' }
}

/** Ingest is not a person: the log says which way the bundle came in. */
export function channelOf(m: BundleOriginFields): EventActor {
  const kind = originKind(m)
  return { channel: kind === 'outline' ? 'bot' : kind === 'package' ? 'package' : 'sync' }
}

const rand = () => crypto.randomUUID().slice(0, 4)

export function eventKey(bundleId: string, at: string, kind: string): string {
  return `${eventsPrefix(bundleId)}${at}-${kind}-${rand()}.json`
}

/** Write one event. `If-None-Match: *` so a name that happens to collide is never overwritten. */
export async function writeEvent(
  bucket: R2Bucket, bundleId: string, actor: EventActor, body: BundleEventBody, at = new Date().toISOString(),
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = eventKey(bundleId, at, body.kind)
    const put = await bucket.put(key, JSON.stringify({ at, actor, ...body }), {
      httpMetadata: { contentType: 'application/json' },
      onlyIf:       { etagDoesNotMatch: '*' },
    })
    if (put) return key
  }
  throw new Error(`writeEvent: no free name for an event of ${bundleId}`)
}

/** `writeEvent` that logs a failure instead of throwing it. */
export async function recordEvent(
  bucket: R2Bucket, bundleId: string, actor: EventActor, body: BundleEventBody,
): Promise<void> {
  try { await writeEvent(bucket, bundleId, actor, body) }
  catch (e) { console.error(`event ${body.kind} for ${bundleId} not recorded:`, (e as Error).message) }
}

/** Every event of a bundle, oldest first. One listing, one read per event. */
export async function listEvents(bucket: R2Bucket, bundleId: string): Promise<BundleEvent[]> {
  const prefix = eventsPrefix(bundleId)
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const listing = await bucket.list({ prefix, cursor })
    for (const o of listing.objects) keys.push(o.key)
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)
  keys.sort()
  const events = await Promise.all(keys.map(async (key) => {
    const obj = await bucket.get(key)
    if (!obj) return null
    try { return { id: key.slice(prefix.length).replace(/\.json$/, ''), ...(await obj.json<Omit<BundleEvent, 'id'>>()) } as BundleEvent }
    catch { return null }
  }))
  return events.filter((e): e is BundleEvent => e !== null)
}

/** What is kept of a deleted bundle until the archive (#188) keeps all of it: who, when, and what it held. */
export interface DeletedRecord {
  bundleId:  string
  summary:   string
  deletedAt: string
  actor:     EventActor
  entities:  { entityId: string; status: string }[]
}

export const deletedKey = (bundleId: string) => `proposals/deleted/${bundleId}.json`
