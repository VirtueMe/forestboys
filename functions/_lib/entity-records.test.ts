import { describe, expect, it, vi } from 'vitest'
import { memoryR2 } from './memory-r2.ts'
import { backfillEntityRecords, dropOldIndexes, listRecords, listRecordsFor, setRecordStatus, setRecordStatusSafe, writeRecordFor } from './entity-records.ts'
import { archiveKey } from '../../src/utils/bundleArchive.ts'

const E = 'Person:ola'
const B1 = 'bundle:ancc:2026-10-01T07:00:00.000Z'
const B2 = 'bundle:sanity-person:2026-10-02T07:00:00.000Z'
const asBucket = (b: ReturnType<typeof memoryR2>) => b as unknown as R2Bucket

describe('entity records', () => {
  it('writes a pointer as the body and the summary in the metadata', async () => {
    const b = memoryR2()
    await writeRecordFor(asBucket(b), B1, E, 'pending', [{ op: 'set-props', props: { rank: {} } }])
    const key = `proposals/by-entity/${E}/${B1}.json`
    expect(b.json(key)).toEqual({ bundleId: B1, entityId: E, payload: `proposals/bundles/${B1}/entity/${E}.json` })
    expect(b.meta(key)).toMatchObject({ status: 'pending', props: 'rank', ops: 'set-props' })
  })

  it('changes the state and keeps what the bundle changes', async () => {
    const b = memoryR2()
    await writeRecordFor(asBucket(b), B1, E, 'pending', [{ op: 'add-edge', type: 'AT', to: 'Location:y' }])
    expect(await setRecordStatus(asBucket(b), E, B1, 'accepted')).toBe(true)
    expect(b.meta(`proposals/by-entity/${E}/${B1}.json`)).toMatchObject({ status: 'accepted', edges: 'AT:Location:y' })
  })

  it('is nothing to fail on when the bundle has no record yet', async () => {
    const b = memoryR2()
    expect(await setRecordStatus(asBucket(b), E, B1, 'denied')).toBe(false)
    expect(b.keys('proposals/by-entity/')).toEqual([])
  })

  it('logs a failed write instead of throwing it', async () => {
    const b = memoryR2()
    await writeRecordFor(asBucket(b), B1, E, 'pending', [])
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(b, 'put').mockRejectedValue(new Error('r2 down'))
    await expect(setRecordStatusSafe(asBucket(b), E, B1, 'accepted')).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('lists the records of one entity in any state, newest bundle first, and skips the old index and other entities', async () => {
    const b = memoryR2({ [`proposals/by-entity/${E}/index.json`]: { bundleIds: [B1] } })
    await writeRecordFor(asBucket(b), B1, E, 'accepted', [{ op: 'set-props', props: { rank: {} } }])
    await writeRecordFor(asBucket(b), B2, E, 'pending', [{ op: 'set-props', props: { rank: {} } }])
    await writeRecordFor(asBucket(b), B1, 'Person:olav', 'pending', [])
    const rows = await listRecords(asBucket(b), E)
    expect(rows.map(r => [r.bundleId, r.status])).toEqual([[B2, 'pending'], [B1, 'accepted']])
  })
})

describe('backfill', () => {
  const man = (id: string, ents: [string, string][]) => ({ bundleId: id, summary: 'x', createdAt: 'x', model: 'none', promptHash: 'none', entities: ents.map(([entityId, status]) => ({ entityId, status, opSummary: [] })) })
  const payload = (entityId: string, props: string[]) => ({ entityId, ops: [{ op: 'set-props', props: Object.fromEntries(props.map(p => [p, {}])) }] })
  const meta = (b: ReturnType<typeof memoryR2>, entityId: string, id: string) => b.meta(`proposals/by-entity/${entityId}/${id}.json`)

  function store() {
    const archived = man(B2, [['Person:ola', 'pending'], ['Person:kari', 'denied']])
    return memoryR2({
      [`proposals/bundles/${B1}/manifest.json`]: man(B1, [['Person:ola', 'accepted'], ['Person:kari', 'pending'], ['Person:per', 'pending']]),
      [`proposals/bundles/${B1}/entity/Person:ola.json`]:  payload('Person:ola', ['rank']),
      [`proposals/bundles/${B1}/entity/Person:kari.json`]: payload('Person:kari', ['born']),
      // Person:per has no payload
      [archiveKey(B2)]: { bundleId: B2, objects: {
        'manifest.json': { value: archived },
        'entity/Person:ola.json': { value: payload('Person:ola', ['rank']) },
        'entity/Person:kari.json': { value: payload('Person:kari', ['died']) },
      } },
      'proposals/by-entity/Person:ola/index.json': { bundleIds: [B1] },
    })
  }

  it('writes a record per entity of every bundle, live and archived, with the manifest\'s status and the ops of the payload', async () => {
    const b = store()
    const r = await backfillEntityRecords(asBucket(b), { write: true })
    expect(r).toMatchObject({ bundles: 2, entities: 5, changed: 5, unchanged: 0, noPayload: 1, next: null })
    expect(meta(b, 'Person:ola', B1)).toMatchObject({ status: 'accepted', props: 'rank' })
    expect(meta(b, 'Person:kari', B1)).toMatchObject({ status: 'pending', props: 'born' })
    expect(meta(b, 'Person:per', B1)).toMatchObject({ status: 'pending', ops: '' })
    expect(meta(b, 'Person:ola', B2)).toMatchObject({ status: 'archived', props: 'rank' })   // pending in an archived bundle
    expect(meta(b, 'Person:kari', B2)).toMatchObject({ status: 'denied', props: 'died' })    // a decided one keeps its status
  })

  it('is a dry run unless asked to write, and says what it would do', async () => {
    const b = store()
    const r = await backfillEntityRecords(asBucket(b), { write: false })
    expect(r).toMatchObject({ changed: 5, unchanged: 0 })
    expect(b.keys('proposals/by-entity/').filter(k => !k.endsWith('index.json'))).toEqual([])
  })

  it('changes nothing the second time, and puts a wrong record right', async () => {
    const b = store()
    await backfillEntityRecords(asBucket(b), { write: true })
    await setRecordStatus(asBucket(b), 'Person:kari', B1, 'denied')
    const again = await backfillEntityRecords(asBucket(b), { write: true })
    expect(again).toMatchObject({ changed: 1, unchanged: 4 })
    expect(meta(b, 'Person:kari', B1)?.status).toBe('pending')
  })

  it('goes on from where a spent budget stopped, to the same result', async () => {
    const b = store()
    let cursor: string | null = null
    let calls = 0
    const total = { changed: 0, entities: 0 }
    do {
      const r = await backfillEntityRecords(asBucket(b), { write: true, budget: 8, cursor })
      total.changed += r.changed; total.entities += r.entities
      cursor = r.next
      calls++
    } while (cursor && calls < 20)
    expect(cursor).toBeNull()
    expect(calls).toBeGreaterThan(1)
    expect(total).toEqual({ changed: 5, entities: 5 })
    expect(meta(b, 'Person:kari', B2)).toMatchObject({ status: 'denied' })
  })

  it('drops the old shared indexes, and only when asked to write', async () => {
    const b = store()
    await backfillEntityRecords(asBucket(b), { write: true })
    expect(await dropOldIndexes(asBucket(b), { write: false })).toEqual({ found: 1, deleted: 0 })
    expect(b.keys('proposals/by-entity/Person:ola/')).toContain('proposals/by-entity/Person:ola/index.json')
    expect(await dropOldIndexes(asBucket(b), { write: true })).toEqual({ found: 1, deleted: 1 })
    expect(b.keys('proposals/by-entity/Person:ola/')).not.toContain('proposals/by-entity/Person:ola/index.json')
    expect(meta(b, 'Person:ola', B1)).toBeDefined()
  })

  it('deletes no more than the limit a call, so a Worker can take them in steps', async () => {
    const b = memoryR2()
    for (const e of ['Person:a', 'Person:b', 'Person:c']) await b.put(`proposals/by-entity/${e}/index.json`, '[]')
    expect(await dropOldIndexes(asBucket(b), { write: true, limit: 2 })).toEqual({ found: 3, deleted: 2 })
    expect(await dropOldIndexes(asBucket(b), { write: true, limit: 2 })).toEqual({ found: 1, deleted: 1 })
    expect(await dropOldIndexes(asBucket(b), { write: true, limit: 2 })).toEqual({ found: 0, deleted: 0 })
  })
})

describe('listRecordsFor', () => {
  it('gives the same records for a few entities (one listing each) and for many (one pass over all)', async () => {
    const b = memoryR2()
    const ids = Array.from({ length: 40 }, (_, i) => `Person:p${i}`)
    for (const id of ids) await writeRecordFor(asBucket(b), B1, id, 'pending', [{ op: 'set-props', props: { rank: {} } }])
    await writeRecordFor(asBucket(b), B2, 'Person:p3', 'accepted', [])
    await writeRecordFor(asBucket(b), B1, 'Person:other', 'pending', [])

    const few  = await listRecordsFor(asBucket(b), ['Person:p3', 'Person:p4'])
    const many = await listRecordsFor(asBucket(b), ids)
    expect(few.get('Person:p3')?.map(r => r.bundleId)).toEqual([B2, B1])
    expect(many.get('Person:p3')).toEqual(few.get('Person:p3'))
    expect(many.get('Person:p4')).toEqual(few.get('Person:p4'))
    expect(many.has('Person:other')).toBe(false)
    expect(many.size).toBe(40)
  })
})
