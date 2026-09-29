/**
 * Partial-date periods on edges (stays, rank history): `YYYY`, `YYYY-MM`
 * or `YYYY-MM-DD`, each end optional. An empty end means open — still
 * held, or unknown — never "the same day".
 */

export const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/

/** Compares by the part both dates know: 1943 vs 1943-05 is equal. */
export function comparePartial(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  return a.slice(0, n) < b.slice(0, n) ? -1 : a.slice(0, n) > b.slice(0, n) ? 1 : 0
}

/** Norwegian error for a bad period, or null. */
export function periodError(start: unknown, end: unknown): string | null {
  for (const [label, v] of [['startdato', start], ['sluttdato', end]] as const) {
    if (v !== null && v !== undefined && (typeof v !== 'string' || !DATE_RE.test(v))) {
      return `Ugyldig ${label}: ${JSON.stringify(v)} — bruk ÅÅÅÅ, ÅÅÅÅ-MM eller ÅÅÅÅ-MM-DD`
    }
  }
  if (typeof start === 'string' && typeof end === 'string' && comparePartial(end, start) < 0) {
    return `Sluttdato ${end} er før startdato ${start}`
  }
  return null
}
