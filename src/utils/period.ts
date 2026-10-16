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

const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember']

interface Parts { y: string; m?: string; d?: number }

function parts(date: string): Parts | null {
  if (!PARTIAL_DATE_RE.test(date)) return null
  const [y, m, d] = date.split('-')
  const month = m ? MONTHS[Number(m) - 1] : undefined
  if (m && !month) return null
  return { y, m: month, d: d ? Number(d) : undefined }
}

/** A partial date in long form (DESIGN.md): 1945, april 1945, 12. april 1945. What is not a date is shown as it is. */
export function formatDateLong(date: string): string {
  const p = parts(date)
  if (!p) return date
  return [p.d ? `${p.d}.` : '', p.m ?? '', p.y].filter(Boolean).join(' ')
}

/**
 * When an event happened, in long form: one date, or a period that does not repeat what both ends share, so
 * 12.–15. april 1945, 12. april – 3. mai 1945, 28. desember 1944 – 3. januar 1945. Without an end, or with the same
 * end, it is the start alone: an operation's end is often not recorded, which is not "still going on". No dates gives ''.
 */
export function formatEventPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return end ? `– ${formatDateLong(end)}` : ''
  if (!end || end === start) return formatDateLong(start)
  const a = parts(start), b = parts(end)
  if (!a || !b) return `${formatDateLong(start)} – ${formatDateLong(end)}`
  if (a.y === b.y && a.m && b.m) {
    if (a.m === b.m && a.d && b.d) return `${a.d}.–${formatDateLong(end)}`
    return `${[a.d ? `${a.d}.` : '', a.m].filter(Boolean).join(' ')} – ${formatDateLong(end)}`
  }
  return `${formatDateLong(start)} – ${formatDateLong(end)}`
}

/** Compares by the part both dates know: 1943 vs 1943-05 is equal. */
export function comparePartial(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  return a.slice(0, n) < b.slice(0, n) ? -1 : a.slice(0, n) > b.slice(0, n) ? 1 : 0
}
