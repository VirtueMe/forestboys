/**
 * Which descriptions hold a link that leads nowhere (GET /api/admin/quality/links).
 *
 * The checking is src/utils/linkCheck.ts, shared with the browser and with the
 * save validator; this only walks the descriptions and says whose they are.
 * Pure: the endpoint hands it the rows.
 */

import { buildIndex, checkLinks, problems, type LinkFinding } from '../../src/utils/linkCheck.ts'
import { KIND_ROUTES, type SlugRow } from '../../src/utils/slugResolver.ts'

/** A Description and the node that owns it. */
export interface DescriptionRow {
  label:   string
  slug:    string | null
  name:    string | null
  descId:  string
  order:   number | null
  content: string | null
  /** For a home-page card: the page it sits on and its id (the card has no page of its own). */
  pageSlug?: string | null
  cardId?:   string | null
}

export interface AuditRow extends LinkFinding {
  /** The node the description belongs to. */
  label:  string
  slug:   string | null
  name:   string
  /** Where to open it: its page, or for a card the admin editor of the page it sits on. */
  path:   string | null
  descId: string
  order:  number | null
}

export interface Audit {
  rows:    AuditRow[]
  /** Descriptions read. */
  scanned: number
  /** Internal and person links checked, good and bad. */
  checked: number
}

function ownerPath(d: DescriptionRow): string | null {
  if (d.label === 'Card') {
    return d.pageSlug ? `/admin/pages/${encodeURIComponent(d.pageSlug)}${d.cardId ? `?card=${encodeURIComponent(d.cardId)}` : ''}` : null
  }
  return d.slug && KIND_ROUTES[d.label] ? KIND_ROUTES[d.label] + encodeURIComponent(d.slug) : null
}

const VERDICT_ORDER = { broken: 0, empty: 1, ambiguous: 2, fixable: 3, ok: 4 } as const

export function auditDescriptions(slugs: SlugRow[], descriptions: DescriptionRow[]): Audit {
  const index = buildIndex(slugs)
  const rows: AuditRow[] = []
  let checked = 0

  for (const d of descriptions) {
    const findings = checkLinks(d.content, index)
    checked += findings.length
    for (const f of problems(findings)) {
      rows.push({
        ...f,
        label:  d.label,
        slug:   d.slug,
        name:   d.name || d.slug || d.descId,
        path:   ownerPath(d),
        descId: d.descId,
        order:  d.order,
      })
    }
  }

  rows.sort((a, b) =>
    VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
    || a.label.localeCompare(b.label)
    || a.name.localeCompare(b.name, 'nb')
    || (a.order ?? 0) - (b.order ?? 0))
  return { rows, scanned: descriptions.length, checked }
}
