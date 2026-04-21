/**
 * Concrete strategies for Person → Unit relations: membership + course
 * attendance. Data-fetching / saving only — labels and display config live
 * in the component props at call site.
 */

import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { authFetch }  from '@/composables/useAuth.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry, RelationStrategy, RelationTarget } from './RelationStrategy.ts'

export const ROLE_LABEL: Record<string, string> = {
  administrative: 'administrativt',
  operational:    'operativt',
  sponsor:        'sponsor',
  parent:         'overordnet',
  operative:      'operatør',
  courier:        'kurér',
  radiotelegraph: 'radiotelegrafist',
  host:           'vert',
  informant:      'informant',
  member:         'medlem',
}

interface CitationRow {
  inline:       boolean | null
  sourceId:     string | null
  sourceTitle:  string | null
  sourceUrl:    string | null
  sourceAuthor: string | null
}

interface SectionRow {
  order:       number | null
  content:     string | null
  citations:   CitationRow[]
  sourcedFrom: {
    id:             string
    title:          string | null
    url:            string | null
    authorFreeText: string | null
    license:        string | null
    attribution:    string | null
  } | null
}

function rowToSection(r: SectionRow): Section {
  return {
    order:   r.order ?? 1,
    content: r.content ?? '[]',
    citations: (r.citations ?? [])
      .filter(c => c.sourceId)
      .map(c => ({
        inline: c.inline ?? false,
        source: {
          id:             c.sourceId!,
          title:          c.sourceTitle,
          url:            c.sourceUrl,
          authorFreeText: c.sourceAuthor,
        },
      })),
    sourcedFrom: r.sourcedFrom ? { ...r.sourcedFrom } : null,
  }
}

function entriesCypher(opts: {
  edge:          string
  noteEdge:      string
  unitWhere:     string
  includeRole:   boolean
  includePassed?: boolean
}): string {
  const roleSel   = opts.includeRole   ? ', m.role AS role'     : ''
  const passedSel = opts.includePassed ? ', m.passed AS passed' : ''
  return `
    MATCH (p:Person {slug: $slug})-[m:${opts.edge}]->(u:Unit)
    WHERE ${opts.unitWhere}
    OPTIONAL MATCH (p)-[:${opts.noteEdge}]->(d:Description)-[:ABOUT_UNIT]->(u)
    OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
    WITH p, m, u, d, from
    OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
    WITH p, m, u, d, from,
         collect(CASE WHEN src IS NULL THEN NULL ELSE {
           inline:       coalesce(cites.inline, false),
           sourceId:     src.id,
           sourceTitle:  src.title,
           sourceUrl:    src.url,
           sourceAuthor: src.authorFreeText
         } END) AS rawCites
    WITH p, m, u,
         CASE WHEN d IS NULL THEN NULL ELSE {
           order:     coalesce(d.order, 1),
           content:   d.content,
           citations: [x IN rawCites WHERE x IS NOT NULL],
           sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
             id:             from.id,
             title:          from.title,
             url:            from.url,
             authorFreeText: from.authorFreeText,
             license:        from.license,
             attribution:    from.attribution
           } END
         } END AS section
    WITH u, m, collect(section) AS rawSections
    RETURN u.slug AS targetSlug, u.canonicalName AS targetName,
           m.startDate AS startDate, m.endDate AS endDate
           ${roleSel}${passedSel},
           [x IN rawSections WHERE x IS NOT NULL] AS sections
    ORDER BY m.startDate, targetName
  `
}

interface EntryRow {
  targetSlug: string
  targetName: string
  startDate:  string | null
  endDate:    string | null
  role?:      string | null
  passed?:    boolean | null
  sections:   SectionRow[]
}

function rowToEntry(r: EntryRow, opts: { includeRole: boolean; includePassed: boolean }): RelationEntry {
  const entry: RelationEntry = {
    targetSlug:     r.targetSlug,
    targetName:     r.targetName,
    startDate:      r.startDate,
    endDate:        r.endDate,
    sections:       (r.sections ?? []).map(rowToSection),
    hasDescription: (r.sections ?? []).length > 0,
  }
  if (opts.includeRole)   entry.role   = r.role   ?? null
  if (opts.includePassed) entry.passed = r.passed ?? null
  return entry
}

async function saveNoteForPair(
  personSlug: string,
  targetSlug: string,
  endpoint:   'membership-note' | 'attendance-note',
  sections:   Section[],
): Promise<void> {
  const payload = {
    sections: [...sections].sort((a, b) => a.order - b.order).map(s => ({
      order:         s.order,
      content:       s.content,
      citations:     s.citations.map(c => ({ inline: c.inline, sourceId: c.source.id })),
      sourcedFromId: s.sourcedFrom?.id ?? null,
    })),
  }
  const res = await authFetch(
    `/api/admin/person/${encodeURIComponent(personSlug)}/${endpoint}/${encodeURIComponent(targetSlug)}`,
    {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    },
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status} on note for ${targetSlug}`)
  }
}

export const MembershipStrategy: RelationStrategy = {
  async fetchTargets(): Promise<RelationTarget[]> {
    const rows = await neo4jQuery<{ slug: string; name: string }>(`
      MATCH (u:Unit)
      WHERE coalesce(u.type, '') <> 'course'
      RETURN u.slug AS slug, u.canonicalName AS name
      ORDER BY u.canonicalName
    `)
    return rows
  },
  async fetchEntries(personSlug) {
    const rows = await neo4jQuery<EntryRow>(
      entriesCypher({ edge: 'MEMBER_OF', noteEdge: 'HAS_MEMBERSHIP_NOTE',
                      unitWhere: "coalesce(u.type, '') <> 'course'", includeRole: true }),
      { slug: personSlug },
    )
    return rows.map(r => rowToEntry(r, { includeRole: true, includePassed: false }))
  },
  async saveEntries(personSlug, entries) {
    const res = await authFetch(`/api/admin/person/${encodeURIComponent(personSlug)}/memberships`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberships: entries.map(e => ({
          unitSlug:  e.targetSlug,
          role:      e.role ?? null,
          startDate: e.startDate,
          endDate:   e.endDate,
        })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote(personSlug, targetSlug, sections) {
    return saveNoteForPair(personSlug, targetSlug, 'membership-note', sections)
  },
  targetRoute(entry) { return `/district/${entry.targetSlug}` },
}

export const AttendanceStrategy: RelationStrategy = {
  async fetchTargets() {
    const rows = await neo4jQuery<{ slug: string; name: string }>(`
      MATCH (u:Unit {type: 'course'})
      RETURN u.slug AS slug, u.canonicalName AS name
      ORDER BY u.canonicalName
    `)
    return rows
  },
  async fetchEntries(personSlug) {
    const rows = await neo4jQuery<EntryRow>(
      entriesCypher({ edge: 'ATTENDED', noteEdge: 'HAS_ATTENDANCE_NOTE',
                      unitWhere: "u.type = 'course'", includeRole: false, includePassed: true }),
      { slug: personSlug },
    )
    return rows.map(r => rowToEntry(r, { includeRole: false, includePassed: true }))
  },
  async saveEntries(personSlug, entries) {
    const res = await authFetch(`/api/admin/person/${encodeURIComponent(personSlug)}/attendances`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendances: entries.map(e => ({
          unitSlug:  e.targetSlug,
          startDate: e.startDate,
          endDate:   e.endDate,
          passed:    e.passed ?? null,
        })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote(personSlug, targetSlug, sections) {
    return saveNoteForPair(personSlug, targetSlug, 'attendance-note', sections)
  },
  targetRoute(entry) { return `/district/${entry.targetSlug}` },
}
