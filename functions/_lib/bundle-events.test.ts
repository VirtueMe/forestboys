import { describe, expect, it, vi } from 'vitest'
import { memoryR2 } from './memory-r2.ts'
import { actorOf, channelOf, eventKey, listEvents, recordEvent, withCurrentNames, writeEvent } from './bundle-events.ts'

const B = 'bundle:package-archive-example:2026-10-08T07:00:00.000Z'
const bucket = () => memoryR2() as never as R2Bucket & ReturnType<typeof memoryR2>

describe('the actor', () => {
  it('is the signed-in user by name and id, and never the email', () => {
    const a = actorOf({ id: 'u1', email: 'rolf@example.org', name: 'Rolf', role: 'admin' })
    expect(a).toEqual({ id: 'u1', name: 'Rolf' })
    expect(JSON.stringify(a)).not.toContain('example.org')
  })

  it('is the channel for a bundle that came through ingest', () => {
    expect(channelOf({ outlineId: 'x' })).toEqual({ channel: 'bot' })
    expect(channelOf({ origin: { type: 'package', site: 'https://a.example', madeAt: '' } } as never)).toEqual({ channel: 'package' })
    expect(channelOf({ origin: { type: 'sanity', sanityType: 'event', runAt: '' } } as never)).toEqual({ channel: 'sync' })
  })
})

describe('the event log', () => {
  it('lists the events of a bundle oldest first, whatever order they were written in', async () => {
    const b = bucket()
    await writeEvent(b, B, { name: 'Rolf' }, { kind: 'unblocked' }, '2026-10-08T09:00:00.000Z')
    await writeEvent(b, B, { name: 'Jan' }, { kind: 'denied', entityId: 'Unit:a', reason: 'feil enhet' }, '2026-10-08T08:00:00.000Z')
    const events = await listEvents(b, B)
    expect(events.map(e => e.kind)).toEqual(['denied', 'unblocked'])
    expect(events[0]).toMatchObject({ at: '2026-10-08T08:00:00.000Z', actor: { name: 'Jan' }, entityId: 'Unit:a' })
  })

  it('keeps two editors acting in the same millisecond apart: two objects, none lost', async () => {
    const b = bucket()
    const at = '2026-10-08T08:00:00.000Z'
    await Promise.all([
      writeEvent(b, B, { name: 'Rolf' }, { kind: 'accepted', entityId: 'Unit:a', message: null, summary: [] }, at),
      writeEvent(b, B, { name: 'Jan' },  { kind: 'accepted', entityId: 'Unit:b', message: null, summary: [] }, at),
    ])
    const events = await listEvents(b, B)
    expect(events.map(e => 'entityId' in e && e.entityId).sort()).toEqual(['Unit:a', 'Unit:b'])
  })

  it('never overwrites an event whose name collides', async () => {
    const b = bucket()
    const at = '2026-10-08T08:00:00.000Z'
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('aaaa-0000-0000-0000-000000000000').mockReturnValueOnce('aaaa-0000-0000-0000-000000000000')
    await writeEvent(b, B, { name: 'Rolf' }, { kind: 'unblocked' }, at)
    await writeEvent(b, B, { name: 'Jan' },  { kind: 'unblocked' }, at)
    expect((await listEvents(b, B)).map(e => 'name' in e.actor && e.actor.name).sort()).toEqual(['Jan', 'Rolf'])
    vi.restoreAllMocks()
  })

  it('does not list another bundle\'s events', async () => {
    const b = bucket()
    await writeEvent(b, B, { name: 'Rolf' }, { kind: 'unblocked' })
    await writeEvent(b, 'bundle:other:2026-10-08T07:00:00.000Z', { name: 'Jan' }, { kind: 'unblocked' })
    expect(await listEvents(b, B)).toHaveLength(1)
  })

  it('names an event by time first, so a listing is chronological', () => {
    expect(eventKey(B, '2026-10-08T08:00:00.000Z', 'denied')).toMatch(/\/events\/2026-10-08T08:00:00\.000Z-denied-[0-9a-f]{4}\.json$/)
  })

  it('does not fail the action when the event cannot be written', async () => {
    const failing = { put: () => Promise.reject(new Error('R2 down')) } as never as R2Bucket
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(recordEvent(failing, B, { name: 'Rolf' }, { kind: 'unblocked' })).resolves.toBeUndefined()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('names in the history', () => {
  const users = (rows: { id: string; name: string | null }[]) => ({
    prepare: () => ({ bind: () => ({ all: () => Promise.resolve({ results: rows }) }) }),
  }) as never as D1Database

  async function log() {
    const b = bucket()
    await writeEvent(b, B, { id: 'u1', name: 'Benny' }, { kind: 'unblocked' }, '2026-10-08T08:00:00.000Z')
    await writeEvent(b, B, { id: 'u2', name: 'Rolf' },  { kind: 'unblocked' }, '2026-10-08T09:00:00.000Z')
    await writeEvent(b, B, { channel: 'package' },      { kind: 'unblocked' }, '2026-10-08T10:00:00.000Z')
    return listEvents(b, B)
  }

  it('shows the name a user has now, found by id, and not the one they had at the time', async () => {
    const events = await withCurrentNames(users([{ id: 'u1', name: 'Benny Thomas' }, { id: 'u2', name: 'Rolf' }]), await log())
    expect(events.map(e => 'name' in e.actor ? e.actor.name : e.actor.channel)).toEqual(['Benny Thomas', 'Rolf', 'package'])
    expect(events[0].actor).toMatchObject({ id: 'u1' })
  })

  it('keeps the stored name of a user who is gone, or whose name is empty', async () => {
    const events = await withCurrentNames(users([{ id: 'u1', name: null }]), await log())
    expect(events.map(e => 'name' in e.actor ? e.actor.name : '-')).toEqual(['Benny', 'Rolf', '-'])
  })

  it('keeps the stored names when there is no table to ask, or it fails', async () => {
    const before = await log()
    expect(await withCurrentNames(undefined, before)).toEqual(before)
    const broken = { prepare: () => { throw new Error('D1 down') } } as never as D1Database
    const log2 = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await withCurrentNames(broken, before)).toEqual(before)
    log2.mockRestore()
  })
})
