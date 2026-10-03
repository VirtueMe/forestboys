import { ref } from 'vue'

/**
 * When the cached lists (IndexedDB) and loaded event details must be fetched
 * again. Visitors get the fast path; editors and admins see their own changes
 * at once. No imports from the data composables, so useAuth can use it
 * without a cycle.
 */

export const VISITOR_MAX_AGE_MS = 5 * 60 * 1000
export const EDITOR_MAX_AGE_MS  = 30 * 1000

/** Bumped after every successful admin write; views that keep data in memory watch it. */
export const cacheVersion = ref(0)

let lastWriteAt = 0

/** An admin write succeeded: whatever was cached before now is out of date. */
export function markCacheStale(now: number = Date.now()): void {
  lastWriteAt = now
  cacheVersion.value++
}

export function lastAdminWriteAt(): number {
  return lastWriteAt
}

export function maxAgeFor(role: string | null | undefined): number {
  return role === 'admin' || role === 'editor' ? EDITOR_MAX_AGE_MS : VISITOR_MAX_AGE_MS
}

/**
 * - `blocked`: written before the latest admin write; show nothing old, fetch first.
 * - `revalidate`: still usable, but past its age for this role; show it, refresh behind.
 * - `fresh`: use as is.
 */
export function cacheState(
  indexedAtMs: number,
  nowMs:       number,
  role:        string | null | undefined,
  writeAtMs:   number = lastWriteAt,
): 'blocked' | 'revalidate' | 'fresh' {
  if (indexedAtMs <= writeAtMs) return 'blocked'
  return nowMs - indexedAtMs > maxAgeFor(role) ? 'revalidate' : 'fresh'
}

/** Writes are POST/PUT/PATCH/DELETE to the admin API. */
export function isAdminWrite(input: RequestInfo | URL, method: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase()
  if (m === 'GET' || m === 'HEAD') return false
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
  return new URL(url, 'https://x.invalid').pathname.startsWith('/api/admin/')
}
