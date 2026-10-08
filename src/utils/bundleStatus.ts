/**
 * What state a proposal bundle is in — derived from its entities, never stored (#185), so it
 * cannot disagree with them whichever code path decided an entity (accept, deny, accept-all,
 * a refusal that set one aside).
 *
 *   pending   at least one entity still waits for a decision
 *   closed    none does: every entity is accepted, denied or drifted (set aside)
 *   blocked   the one stored exception — ingest wrote it because an edge target neither lives
 *             nor is made in the bundle. It shows only while something still waits: a bundle
 *             with nothing left to decide is closed, whatever it was waiting for.
 *
 * `blocked` is cleared only when the child bundle that makes the missing target is sent
 * (`revalidateParent` in ingest). It does not clear on its own when the target turns up in the graph
 * some other way; delete the bundle or send it again.
 */

export type BundleStatus = 'pending' | 'blocked' | 'closed'

export interface BundleStatusInput {
  status?:  BundleStatus
  entities: { status: string }[]
}

export interface BundleCounts {
  pending:  number
  accepted: number
  denied:   number
  /** Refused for a reason that will not go away (the entity exists, a property changed): set aside. */
  drifted:  number
}

export function bundleCounts(entities: { status: string }[]): BundleCounts {
  const c: BundleCounts = { pending: 0, accepted: 0, denied: 0, drifted: 0 }
  for (const e of entities) {
    if (e.status === 'pending' || e.status === 'accepted' || e.status === 'denied' || e.status === 'drifted') c[e.status]++
  }
  return c
}

export function bundleStatus(m: BundleStatusInput): BundleStatus {
  if (bundleCounts(m.entities).pending === 0) return 'closed'
  return m.status === 'blocked' ? 'blocked' : 'pending'
}

export function bundleStatusLabel(s: BundleStatus): string {
  switch (s) {
    case 'pending': return 'Venter'
    case 'blocked': return 'Blokkert'
    case 'closed':  return 'Lukket'
  }
}
