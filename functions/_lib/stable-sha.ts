/**
 * Compute sha256 of a value as stable-key-ordered JSON.
 *
 * Used for:
 *   - Provenance stamps on PT blocks (`sanitySha`, `previousSha`).
 *   - `expectedSha` drift detection on `modify-block` proposal accepts —
 *     server recomputes the live block's sha and compares to what Jan
 *     saw at decision time.
 *
 * Stability guarantees:
 *   - Object keys sorted ascending at every depth.
 *   - Arrays preserve order (semantic — block order is meaningful in PT).
 *   - Primitives serialize via JSON.stringify (covers strings, numbers,
 *     booleans, null).
 */

export async function stableSha(value: unknown): Promise<string> {
  const canonical = canonicalize(value)
  const bytes     = new TextEncoder().encode(canonical)
  const hashBuf   = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}'
}
