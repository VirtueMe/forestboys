/**
 * Display a period from partial dates (YYYY / YYYY-MM / YYYY-MM-DD).
 *
 * An empty end means "unknown or still ongoing", never "same day", so an
 * open period reads "1943 –". No dates at all gives '' (undated links
 * show without an empty dash).
 */
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return ''
  return `${start ?? '?'} –${end ? ` ${end}` : ''}`
}

export const PARTIAL_DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/

/** Compares by the part both dates know: 1943 vs 1943-05 is equal. */
export function comparePartial(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  return a.slice(0, n) < b.slice(0, n) ? -1 : a.slice(0, n) > b.slice(0, n) ? 1 : 0
}
