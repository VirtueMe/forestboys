/**
 * Which descriptions have broken structure inside their blocks (GET /api/admin/quality/html, #128).
 *
 * The checking is src/utils/blockCheck.ts; this walks the descriptions, groups them by the node that
 * owns them and says whose each finding is. Pure: the endpoint hands it the rows.
 *
 * The heading outline is judged the way the save endpoints judge it: an entity's sections (HAS_CONTENT,
 * in order) as one outline. A note on a relation and a card on a page have no such save check and sit under
 * other headings, so they get the block findings only.
 */

import { checkBlocks, checkSections, parseBlocks, type BlockFinding, type BlockKind } from '../../src/utils/blockCheck.ts'
import { ownerPath, type DescriptionRow } from './link-audit.ts'

/** A Description, the node that owns it, and how: `HAS_CONTENT` for a section, else a note. */
export interface SectionRow extends DescriptionRow {
  rel: string
}

export interface BlockAuditRow {
  kind:     BlockKind
  blockKey: string
  text:     string
  detail:   string
  /** The node the description belongs to. */
  label:    string
  slug:     string | null
  name:     string
  /** Where to open it: its page, or for a card the admin editor of the page it sits on. */
  path:     string | null
  descId:   string
  order:    number | null
}

export interface BlockAudit {
  rows:    BlockAuditRow[]
  /** Descriptions read. */
  scanned: number
}

/** Most telling first: what shows on the page, then what is only untidy. */
const KIND_ORDER: BlockKind[] = [
  'empty-heading', 'heading-outline', 'typed-markup', 'dangling-mark', 'list-level-jump', 'stray-list-level', 'unused-definition',
]

const ownerKey = (d: SectionRow) => `${d.label}\u0000${d.slug ?? d.cardId ?? d.descId}`

export function auditBlocks(descriptions: SectionRow[]): BlockAudit {
  const owners = new Map<string, SectionRow[]>()
  for (const d of descriptions) {
    const key = ownerKey(d)
    const list = owners.get(key)
    if (list) list.push(d)
    else owners.set(key, [d])
  }

  const rows: BlockAuditRow[] = []
  const add = (d: SectionRow, f: Omit<BlockFinding, 'content'>) => rows.push({
    kind: f.kind, blockKey: f.blockKey, text: f.text, detail: f.detail,
    label: d.label, slug: d.slug, name: d.name || d.slug || d.descId,
    path: ownerPath(d), descId: d.descId, order: d.order,
  })

  for (const group of owners.values()) {
    // A card sits on a page under other headings, and no save check judges it.
    const judged = group[0].label === 'Card' ? [] : group.filter(d => d.rel === 'HAS_CONTENT').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    for (const f of checkSections(judged.map(d => d.content ?? '[]'))) add(judged[f.content], f)

    for (const d of group) {
      if (judged.includes(d)) continue
      for (const f of checkBlocks(parseBlocks(d.content))) add(d, f)
    }
  }

  rows.sort((a, b) =>
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || a.label.localeCompare(b.label)
    || a.name.localeCompare(b.name, 'nb')
    || (a.order ?? 0) - (b.order ?? 0))
  return { rows, scanned: descriptions.length }
}
