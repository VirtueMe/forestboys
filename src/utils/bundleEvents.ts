/**
 * What happened to a proposal bundle (#190): the shape of an event and how it reads on the page.
 * Pure, shared by the endpoints that write events (functions/_lib/bundle-events.ts) and the page that shows them.
 * docs/PROPOSALS.md, «Events».
 */

import type { BundleCounts } from './bundleStatus.ts'

/** A person (from the session) or, for ingest, the channel the bundle came through: a secret is not a person. */
export type EventActor =
  | { name: string; id?: string }
  | { channel: 'bot' | 'package' | 'sync' }

export type BundleEventBody =
  | { kind: 'received';     entities: number; status: 'pending' | 'blocked'; unresolvedRefs?: string[] }
  | { kind: 'resent';       entities: number; replaced: BundleCounts }
  | { kind: 'blocked';      unresolvedRefs: string[] }
  | { kind: 'unblocked' }
  | { kind: 'accepted';     entityId: string; message: string | null; summary: string[] }
  | { kind: 'denied';       entityId: string; reason: string }
  | { kind: 'refused';      entityId: string; why: string }
  | { kind: 'accepted-all'; accepted: string[]; refused: { entityId: string; why: string }[] }
  // A pointer to a comment, never its text: a comment can be removed without rewriting the history (#186).
  | { kind: 'archived';        reason: string }
  | { kind: 'restored';        reason?: string }
  | { kind: 'commented';       commentId: string; scope: 'bundle' | 'entity'; entityId?: string }
  | { kind: 'comment-removed'; commentId: string; scope: 'bundle' | 'entity'; entityId?: string }

export type BundleEvent = BundleEventBody & {
  /** The object's name under `events/`: unique and sorts by time. */
  id:    string
  at:    string
  actor: EventActor
}

export function actorName(a: EventActor): string {
  if ('name' in a) return a.name
  switch (a.channel) {
    case 'bot':     return 'boten'
    case 'package': return 'en pakke'
    case 'sync':    return 'Sanity-synk'
  }
}

/** The entity an event is about, if it is about one: it is shown on that entity's row too. */
export function eventEntity(e: BundleEvent): string | null {
  return 'entityId' in e && e.entityId ? e.entityId : null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** One event as a line of text (the actor and the time are shown beside it). */
export function eventText(e: BundleEvent): string {
  switch (e.kind) {
    case 'received':
      return `Mottatt: ${plural(e.entities, 'enhet', 'enheter')}${e.status === 'blocked' ? `, blokkert av ${(e.unresolvedRefs ?? []).join(', ')}` : ''}`
    case 'resent': {
      const r = e.replaced
      const was = [r.accepted && `${r.accepted} godkjent`, r.denied && `${r.denied} avvist`, r.drifted && `${r.drifted} satt til side`, r.pending && `${r.pending} ventet`].filter(Boolean).join(', ')
      return `Sendt på nytt: ${plural(e.entities, 'enhet', 'enheter')} er tilbake til «venter»${was ? ` (var: ${was})` : ''}`
    }
    case 'blocked':
      return `Blokkert av ${e.unresolvedRefs.join(', ')}`
    case 'unblocked':
      return 'Ikke lenger blokkert'
    case 'accepted':
      return `Godkjente ${e.entityId}${e.summary.length ? ` (${e.summary.join(', ')})` : ''}${e.message ? `: «${e.message}»` : ''}`
    case 'denied':
      return `Avviste ${e.entityId}: «${e.reason}»`
    case 'refused':
      return `Kunne ikke godkjenne ${e.entityId}: ${e.why}`
    case 'archived':
      return `Arkiverte bundlen: «${e.reason}»`
    case 'restored':
      return `Gjenopprettet fra arkivet${e.reason ? `: «${e.reason}»` : ''}`
    case 'commented':
      return e.scope === 'entity' ? `Kommenterte ${e.entityId}` : 'Kommenterte bundlen'
    case 'comment-removed':
      return e.scope === 'entity' ? `Fjernet en kommentar på ${e.entityId}` : 'Fjernet en kommentar på bundlen'
    case 'accepted-all': {
      const parts = [`godkjente ${plural(e.accepted.length, 'enhet', 'enheter')}`]
      if (e.refused.length) parts.push(`${e.refused.length} ble ikke godkjent: ${e.refused.map(r => `${r.entityId} (${r.why})`).join('; ')}`)
      return `Godkjente alle: ${parts.join(', ')}`
    }
  }
}
