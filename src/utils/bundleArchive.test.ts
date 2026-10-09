import { describe, expect, it } from 'vitest'
import { OPERATION_LIMIT, archiveKey, fromMetadata, isRestorable, operationsNeeded, summaryOf, toMetadata, validateOptionalReason, validateReason } from './bundleArchive.ts'

const manifest = (statuses: string[], extra = {}) => ({
  bundleId: 'bundle:package-x:2026-10-08T07:00:00.000Z', summary: 'Test', createdAt: '2026-10-08T07:00:00.000Z',
  entities: statuses.map(status => ({ status })), ...extra,
})
const by = { actor: { id: 'u1', name: 'Rolf' }, at: '2026-10-09T08:00:00.000Z', reason: 'Testbundle, ikke lenger i bruk' }

describe('validateReason', () => {
  it('takes a written reason, trimmed', () => expect(validateReason({ reason: '  Testbundle  ' })).toBe('Testbundle'))
  it('refuses none, a short one and a long one', () => {
    expect(validateReason({})).toMatchObject({ error: expect.stringContaining('reason required') })
    expect(validateReason({ reason: 'ok' })).toMatchObject({ error: expect.stringContaining('at least') })
    expect(validateReason({ reason: 'x'.repeat(501) })).toMatchObject({ error: expect.stringContaining('longer') })
    expect(validateReason(null)).toMatchObject({ error: expect.any(String) })
  })
})

describe('validateOptionalReason', () => {
  it('takes none, an empty one and a blank one as none', () => {
    expect(validateOptionalReason(undefined)).toBeNull()
    expect(validateOptionalReason(null)).toBeNull()
    expect(validateOptionalReason({})).toBeNull()
    expect(validateOptionalReason({ reason: '   ' })).toBeNull()
  })
  it('takes a written one, trimmed, and refuses text that is not text or is too long', () => {
    expect(validateOptionalReason({ reason: ' Trengs likevel ' })).toBe('Trengs likevel')
    expect(validateOptionalReason({ reason: 5 })).toMatchObject({ error: expect.any(String) })
    expect(validateOptionalReason({ reason: 'x'.repeat(501) })).toMatchObject({ error: expect.stringContaining('longer') })
  })
})

describe('what may be restored', () => {
  it('a bundle nothing of which was accepted', () => {
    expect(isRestorable({ pending: 2, accepted: 0, denied: 1, drifted: 1 })).toBe(true)
  })
  it('not one whose ops are in the graph', () => {
    expect(isRestorable({ pending: 0, accepted: 1, denied: 0, drifted: 0 })).toBe(false)
  })
})

describe('summaryOf and the metadata of the archive object', () => {
  it('derives the status and the counts from the entities, and says who, when and why', () => {
    const s = summaryOf(manifest(['accepted', 'denied']), by)
    expect(s).toMatchObject({ status: 'closed', entities: 2, counts: { accepted: 1, denied: 1, pending: 0, drifted: 0 }, restorable: false, archivedBy: 'Rolf', archivedById: 'u1', reason: by.reason })
  })

  it('survives the trip through the metadata, which is only strings', () => {
    const s = summaryOf(manifest(['pending', 'drifted']), by)
    const meta = toMetadata(s)
    expect(Object.values(meta).every(v => typeof v === 'string')).toBe(true)
    expect(fromMetadata(meta)).toEqual(s)
  })

  it('stays under R2\'s 2 KB of metadata whatever the texts are', () => {
    const s = summaryOf(manifest(['pending'], { summary: 'å'.repeat(5000) }), { ...by, reason: 'ø'.repeat(500) })
    const bytes = Object.entries(toMetadata(s)).reduce((n, [k, v]) => n + new TextEncoder().encode(k + v).length, 0)
    expect(bytes).toBeLessThan(2048)
  })

  it('reads nothing from metadata that is not an archive object\'s', () => {
    expect(fromMetadata(undefined)).toBeNull()
    expect(fromMetadata({ type: 'bundle' })).toBeNull()
  })
})

describe('the operation budget', () => {
  it('lets the biggest bundle of #158 through, all of its 287 entities pending', () => {
    // manifest + 287 payloads + a few records and events
    expect(operationsNeeded(300, 287)).toBeLessThanOrEqual(OPERATION_LIMIT)
  })
  it('refuses one that would not fit', () => expect(operationsNeeded(600, 600)).toBeGreaterThan(OPERATION_LIMIT))
  it('keeps its object under the archive prefix', () => expect(archiveKey('bundle:a:b')).toBe('proposals/archive/bundle:a:b.json'))
})
