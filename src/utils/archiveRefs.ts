// Short archive references written into descriptions (`AIR-27-1068-2 p13`) become links to
// the National Archives (TNA, Kew) search, which wants `AIR 27/1068-2`.
//
// The links are stored: the Sanity sync runs `linkArchiveBlocks` on a description before it
// compares and before it saves (scripts/lib/event-sync.ts, event-rule.ts), so the graph holds
// ordinary link marks and the page needs nothing special. Only the AIR 27 series is linked
// (Jan, #106): few HS files can be downloaded.

const SEARCH = 'https://discovery.nationalarchives.gov.uk/results/r'

/**
 * `AIR-27-1068-2`, `AIR 27/1068-2`, `air-27-1649_2`, `AIR-27-1908-23+24`.
 * - 1: the piece (`1068`), 2: the item (`2`), optional.
 * - A `_2` volume suffix (TNA splits big files for download) and a `+24` second item are part
 *   of what is written, so they stay inside the link text, but are not searched for (Jan).
 * - The page that follows (`p13`, `s 6`, `p345 / 365`) is not matched: it stays plain text.
 */
const REF = /(?<![A-Za-z0-9])AIR[- ]27[-/](\d+)(?:-(\d+))?(?:_\d+)?(?:\+\d+)?(?![\w-])/gi

/** The TNA search for one AIR 27 piece, with the item when there is one. */
export function tnaSearchUrl(piece: string, item?: string): string {
  const q = encodeURIComponent(`AIR 27/${piece}${item ? `-${item}` : ''}`)
  return `${SEARCH}?_q=${q}&_col=200&_cr1=AIR%2027&_dss=range&_sd=1940&_ed=1945&_hb=tna&_rv=simple`
}

interface Span { _key: string; _type: string; text?: string; marks?: string[]; [k: string]: unknown }
interface MarkDef { _key: string; _type: string; href?: string; slug?: string; [k: string]: unknown }
interface Block { _type: string; children?: Span[]; markDefs?: MarkDef[]; [k: string]: unknown }

/** A span that already is a link — `renderSpans()` draws a link or person mark as one, and a link can't hold a link. */
const isLinked = (span: Span, defs: MarkDef[]) =>
  (span.marks ?? []).some(m => defs.some(d => d._key === m && ((d._type === 'link' && d.href) || (d._type === 'person' && d.slug))))

/**
 * A portable-text description with every AIR 27 reference in its own span, carrying a `link`
 * mark to the TNA search. The span keeps its other marks (bold, underline). The page after the
 * reference stays in the span beside it.
 *
 * - Spans that are already links are left alone, so running it twice changes nothing.
 * - The new keys come from the span's key (`<span>-<n>`, `tna-<span>-<n>`), so the same input
 *   always gives the same output — the sync hashes this.
 * - Nothing to link: the input itself is returned.
 */
export function linkArchiveBlocks<T>(blocks: T): T {
  if (!Array.isArray(blocks)) return blocks
  let changed = false
  const out = (blocks as Block[]).map(block => {
    if (block?._type !== 'block' || !Array.isArray(block.children)) return block
    const defs = block.markDefs ?? []
    const added: MarkDef[] = []
    const children = block.children.flatMap(span => {
      const text = span.text ?? ''
      if (isLinked(span, defs)) return [span]
      const refs = [...text.matchAll(REF)]
      if (!refs.length) return [span]

      const parts: Span[] = []
      const push = (t: string, marks: string[]) => {
        if (t) parts.push({ ...span, _key: parts.length ? `${span._key}-${parts.length}` : span._key, text: t, marks })
      }
      let at = 0
      for (const m of refs) {
        const key = `tna-${span._key}-${added.length}`
        added.push({ _key: key, _type: 'link', href: tnaSearchUrl(m[1], m[2]) })
        push(text.slice(at, m.index), span.marks ?? [])
        push(m[0], [...(span.marks ?? []), key])
        at = m.index + m[0].length
      }
      push(text.slice(at), span.marks ?? [])
      return parts
    })
    if (!added.length) return block
    changed = true
    return { ...block, children, markDefs: [...defs, ...added] }
  })
  return (changed ? out : blocks) as T
}
