/**
 * Hashing for the Sanity sync (docs/SANITY-SYNC.md): a field's value is
 * hashed as stable JSON, so key order in Sanity's response doesn't count
 * as a change.
 */
import { createHash } from 'node:crypto'

/** JSON with object keys sorted. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

export const fieldSha = (v: unknown): string => createHash('sha256').update(stableJson(v)).digest('hex')
