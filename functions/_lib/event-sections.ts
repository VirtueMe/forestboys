/**
 * Description sections for an Operation or Incident (PATCH
 * /api/admin/event/:slug/sections). Pure parts: validating the payload and
 * planning what happens to the Description nodes already there.
 *
 * A section is a slot, numbered by `order`. A save updates the node that
 * holds a slot in place and keeps its id, so the text imported from Sanity
 * (`desc:event:<sanityId>`, order 1) stays that node: the nightly sync keeps
 * finding it, and an edit shows up as a graph-side change it will not
 * overwrite. New slots get `desc:event:<slug>:<order>`; nodes whose slot is
 * gone, and any second node in a slot, are deleted.
 */

export interface CitationInput { inline: boolean; sourceId: string }

export interface SectionInput {
  order:          number
  content:        string
  citations?:     CitationInput[]
  sourcedFromId?: string | null
}

export interface CleanSection {
  order:         number
  content:       string
  citations:     CitationInput[]
  sourcedFromId: string | null
}

/** The validated sections, or the message for a 400. */
export function validateSections(input: unknown): { sections: CleanSection[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'sections must be an array' }
  const seen = new Set<number>()
  const out: CleanSection[] = []
  for (const s of input as SectionInput[]) {
    if (!s || typeof s !== 'object') return { error: 'Bad section' }
    if (!Number.isInteger(s.order) || s.order < 1) return { error: `Bad section order: ${s.order}` }
    if (seen.has(s.order)) return { error: `Section order twice: ${s.order}` }
    seen.add(s.order)
    if (typeof s.content !== 'string') return { error: 'Bad section content' }
    try { JSON.parse(s.content) } catch { return { error: 'section content must be JSON' } }
    if (s.citations !== undefined) {
      if (!Array.isArray(s.citations)) return { error: 'Bad citations type' }
      for (const c of s.citations) {
        if (typeof c.sourceId !== 'string' || !c.sourceId) return { error: 'Bad citation sourceId' }
        if (typeof c.inline   !== 'boolean')               return { error: 'Bad citation inline' }
      }
    }
    if (s.sourcedFromId !== undefined && s.sourcedFromId !== null && typeof s.sourcedFromId !== 'string') {
      return { error: 'Bad sourcedFromId' }
    }
    out.push({
      order:         s.order,
      content:       s.content,
      citations:     s.citations ?? [],
      sourcedFromId: typeof s.sourcedFromId === 'string' ? s.sourcedFromId : null,
    })
  }
  return { sections: out.sort((a, b) => a.order - b.order) }
}

export interface ExistingSection { id: string; order: number }

export interface SectionPlan {
  /** Nodes to delete: their slot is gone, or another node already holds it. */
  deleteIds: string[]
  /** Sections whose slot has a node: update it, keep the id. */
  update: (CleanSection & { id: string })[]
  /** Sections for a slot with no node: create it. */
  create: (CleanSection & { id: string })[]
}

export function planSections(slug: string, existing: ExistingSection[], sections: CleanSection[]): SectionPlan {
  const holder = new Map<number, string>()          // order -> id of the node that keeps the slot
  const deleteIds: string[] = []
  for (const e of [...existing].sort((a, b) => a.id.localeCompare(b.id))) {
    const order = Number(e.order)
    if (holder.has(order)) deleteIds.push(e.id)
    else holder.set(order, e.id)
  }

  const wanted = new Set(sections.map(s => s.order))
  for (const [order, id] of holder) if (!wanted.has(order)) { deleteIds.push(id); holder.delete(order) }

  const update: SectionPlan['update'] = []
  const create: SectionPlan['create'] = []
  for (const s of sections) {
    const id = holder.get(s.order)
    if (id) update.push({ ...s, id })
    else create.push({ ...s, id: `desc:event:${slug}:${s.order}` })
  }
  return { deleteIds, update, create }
}
