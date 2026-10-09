import { describe, expect, it } from 'vitest'
import { actorName, eventEntity, eventText, type BundleEvent } from './bundleEvents.ts'

const base = { id: '2026-10-08T10:00:00.000Z-accepted-ab12', at: '2026-10-08T10:00:00.000Z', actor: { name: 'Rolf' } }
const ev = (b: object) => ({ ...base, ...b }) as BundleEvent

describe('actorName', () => {
  it('names a person', () => expect(actorName({ name: 'Rolf' })).toBe('Rolf'))
  it('names the channel for ingest', () => {
    expect(actorName({ channel: 'package' })).toBe('en pakke')
    expect(actorName({ channel: 'sync' })).toBe('Sanity-synk')
    expect(actorName({ channel: 'bot' })).toBe('boten')
  })
})

describe('eventEntity', () => {
  it('is the entity of an event that is about one', () => {
    expect(eventEntity(ev({ kind: 'denied', entityId: 'Unit:a', reason: 'feil' }))).toBe('Unit:a')
    expect(eventEntity(ev({ kind: 'refused', entityId: 'Unit:b', why: 'x' }))).toBe('Unit:b')
  })
  it('is null for one about the bundle', () => expect(eventEntity(ev({ kind: 'unblocked' }))).toBeNull())
})

describe('eventText', () => {
  it('says what was accepted, with the ops and the message', () => {
    expect(eventText(ev({ kind: 'accepted', entityId: 'Unit:a', message: 'ok', summary: ['create'] })))
      .toBe('Godkjente Unit:a (create): «ok»')
    expect(eventText(ev({ kind: 'accepted', entityId: 'Unit:a', message: null, summary: [] }))).toBe('Godkjente Unit:a')
  })
  it('says what was refused, in words', () => {
    expect(eventText(ev({ kind: 'refused', entityId: 'Unit:a', why: 'Finnes allerede i grafen.' })))
      .toBe('Kunne ikke godkjenne Unit:a: Finnes allerede i grafen.')
  })
  it('says what a resend replaced', () => {
    expect(eventText(ev({ kind: 'resent', entities: 1, replaced: { pending: 0, accepted: 1, denied: 0, drifted: 0 } })))
      .toBe('Sendt på nytt: 1 enhet er tilbake til «venter» (var: 1 godkjent)')
  })
  it('gives a received bundle its entities and what blocks it', () => {
    expect(eventText(ev({ kind: 'received', entities: 3, status: 'pending' }))).toBe('Mottatt: 3 enheter')
    expect(eventText(ev({ kind: 'received', entities: 2, status: 'blocked', unresolvedRefs: ['Unit:x'] }))).toContain('blokkert av Unit:x')
  })
  it('points at a comment and never carries its text', () => {
    expect(eventText(ev({ kind: 'commented', commentId: 'c1', scope: 'entity', entityId: 'Unit:a' }))).toBe('Kommenterte Unit:a')
    expect(eventText(ev({ kind: 'commented', commentId: 'c1', scope: 'bundle' }))).toBe('Kommenterte bundlen')
    expect(eventText(ev({ kind: 'comment-removed', commentId: 'c1', scope: 'bundle' }))).toBe('Fjernet en kommentar på bundlen')
    expect(eventEntity(ev({ kind: 'commented', commentId: 'c1', scope: 'entity', entityId: 'Unit:a' }))).toBe('Unit:a')
    expect(eventEntity(ev({ kind: 'commented', commentId: 'c1', scope: 'bundle' }))).toBeNull()
  })
  it('says that a bundle was archived, and why, and that it came back', () => {
    expect(eventText(ev({ kind: 'archived', reason: 'Testbundle' }))).toBe('Arkiverte bundlen: «Testbundle»')
    expect(eventText(ev({ kind: 'restored' }))).toBe('Gjenopprettet fra arkivet')
    expect(eventText(ev({ kind: 'restored', reason: 'Rolf trenger den likevel' }))).toBe('Gjenopprettet fra arkivet: «Rolf trenger den likevel»')
  })
  it('puts accept-all in one line, with what the guard refused', () => {
    expect(eventText(ev({ kind: 'accepted-all', accepted: ['Unit:a', 'Unit:b'], refused: [{ entityId: 'Unit:c', why: 'Finnes allerede i grafen.' }] })))
      .toBe('Godkjente alle: godkjente 2 enheter, 1 ble ikke godkjent: Unit:c (Finnes allerede i grafen.)')
  })
})
