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
