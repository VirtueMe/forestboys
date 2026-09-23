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

/** Roles valid on PART_OF (Unit → Organization). Must mirror the backend's
 *  VALID_ROLES in /api/admin/organization/:slug/units. */
export const PART_OF_ROLE_LABEL: Record<string, string> = {
  administrative: 'administrativt',
  operational:    'operativt',
  sponsor:        'sponsor',
  parent:         'overordnet',
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
  endpoint:   'membership-note' | 'attendance-note' | 'incident-note' | 'operation-note',
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

/**
 * Incident relation — Person is INVOLVED_IN one or more Incidents. Unlike
 * Medlemskap/Kurs, the target is an Incident node (not a Unit) and has its
 * own date. The Person→Incident edge itself carries no metadata; the per-
 * person note lives on a Description attached via HAS_INCIDENT_NOTE.
 */
export const IncidentStrategy: RelationStrategy = {
  async fetchTargets(): Promise<RelationTarget[]> {
    const rows = await neo4jQuery<{ slug: string; name: string }>(`
      MATCH (i:Incident)
      RETURN i.slug AS slug,
             i.title + CASE WHEN i.date IS NOT NULL THEN ' · ' + i.date ELSE '' END AS name
      ORDER BY i.date DESC, i.title
    `)
    return rows
  },
  async fetchEntries(personSlug) {
    const rows = await neo4jQuery<EntryRow>(`
      MATCH (p:Person {slug: $slug})-[:INVOLVED_IN]->(i:Incident)
      OPTIONAL MATCH (p)-[:HAS_INCIDENT_NOTE]->(d:Description)-[:ABOUT_INCIDENT]->(i)
      OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
      WITH p, i, d, from
      OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
      WITH p, i, d, from,
           collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
      WITH i, d, from,
           CASE WHEN d IS NULL THEN NULL ELSE {
             order:     coalesce(d.order, 1),
             content:   d.content,
             citations: [x IN rawCites WHERE x IS NOT NULL],
             sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
               id:             from.id,
               title:          from.title,
               url:             from.url,
               authorFreeText: from.authorFreeText,
               license:        from.license,
               attribution:    from.attribution
             } END
           } END AS section
      WITH i, collect(section) AS rawSections
      RETURN i.slug AS targetSlug,
             i.title AS targetName,
             i.date AS startDate,
             NULL AS endDate,
             [x IN rawSections WHERE x IS NOT NULL] AS sections
      ORDER BY coalesce(i.date, ''), targetName
    `, { slug: personSlug })
    return rows.map(r => rowToEntry(r, { includeRole: false, includePassed: false }))
  },
  async saveEntries(personSlug, entries) {
    const res = await authFetch(`/api/admin/person/${encodeURIComponent(personSlug)}/incidents`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incidents: entries.map(e => ({ incidentSlug: e.targetSlug })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote(personSlug, targetSlug, sections) {
    return saveNoteForPair(personSlug, targetSlug, 'incident-note', sections)
  },
  targetRoute(entry) { return `/events/${entry.targetSlug}` },
}

/**
 * Operation relation — Person PARTICIPATED_IN one or more Operations. An
 * Operation is a named mission (codeName) that groups Incidents. The
 * person-side edge is independent of incident involvement: Jan often knows
 * someone was part of Gunnerside without having a specific incident tied
 * to that person.
 */
export const OperationStrategy: RelationStrategy = {
  async fetchTargets(): Promise<RelationTarget[]> {
    const rows = await neo4jQuery<{ slug: string; name: string }>(`
      MATCH (op:Operation)
      RETURN op.slug AS slug, op.codeName AS name
      ORDER BY op.codeName
    `)
    return rows
  },
  async fetchEntries(personSlug) {
    const rows = await neo4jQuery<EntryRow>(`
      MATCH (p:Person {slug: $slug})-[:PARTICIPATED_IN]->(op:Operation)
      OPTIONAL MATCH (p)-[:HAS_OPERATION_NOTE]->(d:Description)-[:ABOUT_OPERATION]->(op)
      OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
      WITH p, op, d, from
      OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
      WITH p, op, d, from,
           collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
      WITH op, d, from,
           CASE WHEN d IS NULL THEN NULL ELSE {
             order:     coalesce(d.order, 1),
             content:   d.content,
             citations: [x IN rawCites WHERE x IS NOT NULL],
             sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
               id:             from.id,
               title:          from.title,
               url:             from.url,
               authorFreeText: from.authorFreeText,
               license:        from.license,
               attribution:    from.attribution
             } END
           } END AS section
      WITH op, collect(section) AS rawSections
      RETURN op.slug AS targetSlug,
             op.codeName AS targetName,
             NULL AS startDate,
             NULL AS endDate,
             [x IN rawSections WHERE x IS NOT NULL] AS sections
      ORDER BY targetName
    `, { slug: personSlug })
    return rows.map(r => rowToEntry(r, { includeRole: false, includePassed: false }))
  },
  async saveEntries(personSlug, entries) {
    const res = await authFetch(`/api/admin/person/${encodeURIComponent(personSlug)}/operations`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: entries.map(e => ({ operationSlug: e.targetSlug })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote(personSlug, targetSlug, sections) {
    return saveNoteForPair(personSlug, targetSlug, 'operation-note', sections)
  },
  targetRoute(entry) { return `/outlines/${entry.targetSlug}` },
}

/**
 * Inverse relation — PersonInvolvementStrategy is used from the Incident
 * side: given an Incident slug (parentSlug), list the Persons who are
 * INVOLVED_IN it. Uses the same Description nodes as IncidentStrategy;
 * the note is person-scoped regardless of which side edits it.
 */
interface PersonEntryRow {
  targetSlug: string
  targetName: string
  sections:   SectionRow[]
}

function personRowToEntry(r: PersonEntryRow): RelationEntry {
  return {
    targetSlug:     r.targetSlug,
    targetName:     r.targetName,
    startDate:      null,
    endDate:        null,
    sections:       (r.sections ?? []).map(rowToSection),
    hasDescription: (r.sections ?? []).length > 0,
  }
}

export const PersonInvolvementStrategy: RelationStrategy = {
  async fetchTargets(): Promise<RelationTarget[]> {
    const rows = await neo4jQuery<{ slug: string; name: string }>(`
      MATCH (p:Person)
      RETURN p.slug AS slug,
             p.canonicalName + CASE WHEN p.birthYear IS NOT NULL THEN ' (' + toString(p.birthYear) + ')' ELSE '' END AS name
      ORDER BY p.canonicalName
    `)
    return rows
  },
  async fetchEntries(incidentSlug) {
    const rows = await neo4jQuery<PersonEntryRow>(`
      MATCH (p:Person)-[:INVOLVED_IN]->(i:Incident {slug: $slug})
      OPTIONAL MATCH (p)-[:HAS_INCIDENT_NOTE]->(d:Description)-[:ABOUT_INCIDENT]->(i)
      OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
      WITH p, d, from
      OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
      WITH p, d, from,
           collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
      WITH p, d, from,
           CASE WHEN d IS NULL THEN NULL ELSE {
             order:     coalesce(d.order, 1),
             content:   d.content,
             citations: [x IN rawCites WHERE x IS NOT NULL],
             sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
               id:             from.id,
               title:          from.title,
               url:             from.url,
               authorFreeText: from.authorFreeText,
               license:        from.license,
               attribution:    from.attribution
             } END
           } END AS section
      WITH p, collect(section) AS rawSections
      RETURN p.slug AS targetSlug, p.canonicalName AS targetName,
             [x IN rawSections WHERE x IS NOT NULL] AS sections
      ORDER BY targetName
    `, { slug: incidentSlug })
    return rows.map(personRowToEntry)
  },
  async saveEntries(incidentSlug, entries) {
    const res = await authFetch(`/api/admin/incident/${encodeURIComponent(incidentSlug)}/persons`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        persons: entries.map(e => ({ personSlug: e.targetSlug })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  // saveNote flips the pivot — the note is stored on Person side, so the
  // person-note endpoint (incident-note) does the work. incidentSlug is the
  // "parent" here, targetSlug the person slug.
  async saveNote(incidentSlug, personSlug, sections) {
    const payload = {
      sections: [...sections].sort((a, b) => a.order - b.order).map(s => ({
        order:         s.order,
        content:       s.content,
        citations:     s.citations.map(c => ({ inline: c.inline, sourceId: c.source.id })),
        sourcedFromId: s.sourcedFrom?.id ?? null,
      })),
    }
    const res = await authFetch(
      `/api/admin/person/${encodeURIComponent(personSlug)}/incident-note/${encodeURIComponent(incidentSlug)}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      },
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status} on note for ${personSlug}`)
    }
  },
  targetRoute(entry) { return `/person/${entry.targetSlug}` },
}

/**
 * Inverse — PersonParticipationStrategy, used from the Operation side.
 * Mirrors PersonInvolvementStrategy but for PARTICIPATED_IN.
 */
export const PersonParticipationStrategy: RelationStrategy = {
  fetchTargets: () => PersonInvolvementStrategy.fetchTargets(),
  async fetchEntries(operationSlug) {
    const rows = await neo4jQuery<PersonEntryRow>(`
      MATCH (p:Person)-[:PARTICIPATED_IN]->(op:Operation {slug: $slug})
      OPTIONAL MATCH (p)-[:HAS_OPERATION_NOTE]->(d:Description)-[:ABOUT_OPERATION]->(op)
      OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
      WITH p, d, from
      OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
      WITH p, d, from,
           collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
      WITH p, d, from,
           CASE WHEN d IS NULL THEN NULL ELSE {
             order:     coalesce(d.order, 1),
             content:   d.content,
             citations: [x IN rawCites WHERE x IS NOT NULL],
             sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
               id:             from.id,
               title:          from.title,
               url:             from.url,
               authorFreeText: from.authorFreeText,
               license:        from.license,
               attribution:    from.attribution
             } END
           } END AS section
      WITH p, collect(section) AS rawSections
      RETURN p.slug AS targetSlug, p.canonicalName AS targetName,
             [x IN rawSections WHERE x IS NOT NULL] AS sections
      ORDER BY targetName
    `, { slug: operationSlug })
    return rows.map(personRowToEntry)
  },
  async saveEntries(operationSlug, entries) {
    const res = await authFetch(`/api/admin/operation/${encodeURIComponent(operationSlug)}/persons`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persons: entries.map(e => ({ personSlug: e.targetSlug })) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  async saveNote(operationSlug, personSlug, sections) {
    return saveNoteForPair(personSlug, operationSlug, 'operation-note', sections)
  },
  targetRoute(entry) { return `/person/${entry.targetSlug}` },
}

/**
 * Inverse — UnitMembersStrategy, used from the Unit (non-course) side.
 * Person row carries role + dates from the MEMBER_OF edge.
 */
interface PersonMemberRow extends PersonEntryRow {
  role:      string | null
  startDate: string | null
  endDate:   string | null
}

function personMemberRowToEntry(r: PersonMemberRow): RelationEntry {
  return {
    targetSlug:     r.targetSlug,
    targetName:     r.targetName,
    startDate:      r.startDate,
    endDate:        r.endDate,
    role:           r.role ?? null,
    sections:       (r.sections ?? []).map(rowToSection),
    hasDescription: (r.sections ?? []).length > 0,
  }
}

export const UnitMembersStrategy: RelationStrategy = {
  fetchTargets: () => PersonInvolvementStrategy.fetchTargets(),
  async fetchEntries(unitSlug) {
    const rows = await neo4jQuery<PersonMemberRow>(`
      MATCH (p:Person)-[m:MEMBER_OF]->(u:Unit {slug: $slug})
      OPTIONAL MATCH (p)-[:HAS_MEMBERSHIP_NOTE]->(d:Description)-[:ABOUT_UNIT]->(u)
      OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
      WITH p, m, d, from
      OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
      WITH p, m, d, from,
           collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
      WITH p, m, d, from,
           CASE WHEN d IS NULL THEN NULL ELSE {
             order:     coalesce(d.order, 1),
             content:   d.content,
             citations: [x IN rawCites WHERE x IS NOT NULL],
             sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
               id:             from.id,
               title:          from.title,
               url:             from.url,
               authorFreeText: from.authorFreeText,
               license:        from.license,
               attribution:    from.attribution
             } END
           } END AS section
      WITH p, m, collect(section) AS rawSections
      RETURN p.slug AS targetSlug, p.canonicalName AS targetName,
             m.role AS role, m.startDate AS startDate, m.endDate AS endDate,
             [x IN rawSections WHERE x IS NOT NULL] AS sections
      ORDER BY m.startDate, targetName
    `, { slug: unitSlug })
    return rows.map(personMemberRowToEntry)
  },
  async saveEntries(unitSlug, entries) {
    const res = await authFetch(`/api/admin/unit/${encodeURIComponent(unitSlug)}/members`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        members: entries.map(e => ({
          personSlug: e.targetSlug,
          role:       e.role ?? null,
          startDate:  e.startDate,
          endDate:    e.endDate,
        })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  async saveNote(unitSlug, personSlug, sections) {
    return saveNoteForPair(personSlug, unitSlug, 'membership-note', sections)
  },
  targetRoute(entry) { return `/person/${entry.targetSlug}` },
}

/**
 * Inverse — UnitAttendeesStrategy, used from the course-Unit side.
 * Person row carries passed + dates from the ATTENDED edge.
 */
interface PersonAttendeeRow extends PersonEntryRow {
  passed:    boolean | null
  startDate: string | null
  endDate:   string | null
}

function personAttendeeRowToEntry(r: PersonAttendeeRow): RelationEntry {
  return {
    targetSlug:     r.targetSlug,
    targetName:     r.targetName,
    startDate:      r.startDate,
    endDate:        r.endDate,
    passed:         r.passed ?? null,
    sections:       (r.sections ?? []).map(rowToSection),
    hasDescription: (r.sections ?? []).length > 0,
  }
}

export const UnitAttendeesStrategy: RelationStrategy = {
  fetchTargets: () => PersonInvolvementStrategy.fetchTargets(),
  async fetchEntries(unitSlug) {
    const rows = await neo4jQuery<PersonAttendeeRow>(`
      MATCH (p:Person)-[a:ATTENDED]->(u:Unit {slug: $slug})
      OPTIONAL MATCH (p)-[:HAS_ATTENDANCE_NOTE]->(d:Description)-[:ABOUT_UNIT]->(u)
      OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
      WITH p, a, d, from
      OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
      WITH p, a, d, from,
           collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
      WITH p, a, d, from,
           CASE WHEN d IS NULL THEN NULL ELSE {
             order:     coalesce(d.order, 1),
             content:   d.content,
             citations: [x IN rawCites WHERE x IS NOT NULL],
             sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
               id:             from.id,
               title:          from.title,
               url:             from.url,
               authorFreeText: from.authorFreeText,
               license:        from.license,
               attribution:    from.attribution
             } END
           } END AS section
      WITH p, a, collect(section) AS rawSections
      RETURN p.slug AS targetSlug, p.canonicalName AS targetName,
             a.passed AS passed, a.startDate AS startDate, a.endDate AS endDate,
             [x IN rawSections WHERE x IS NOT NULL] AS sections
      ORDER BY a.startDate, targetName
    `, { slug: unitSlug })
    return rows.map(personAttendeeRowToEntry)
  },
  async saveEntries(unitSlug, entries) {
    const res = await authFetch(`/api/admin/unit/${encodeURIComponent(unitSlug)}/attendees`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendees: entries.map(e => ({
          personSlug: e.targetSlug,
          passed:     e.passed ?? null,
          startDate:  e.startDate,
          endDate:    e.endDate,
        })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  async saveNote(unitSlug, personSlug, sections) {
    return saveNoteForPair(personSlug, unitSlug, 'attendance-note', sections)
  },
  targetRoute(entry) { return `/person/${entry.targetSlug}` },
}

/**
 * Hierarchy strategies — structure edits on EventDetail. None of these
 * carry person-scoped descriptions; saveNote is a no-op.
 */

async function noopSaveNote(): Promise<void> { /* hierarchy relations have no description notes */ }

interface HierarchyRow {
  targetSlug: string
  targetName: string
}

function hierarchyRowToEntry(r: HierarchyRow): RelationEntry {
  return {
    targetSlug:     r.targetSlug,
    targetName:     r.targetName,
    startDate:      null,
    endDate:        null,
    sections:       [],
    hasDescription: false,
  }
}

async function fetchIncidentOptions(): Promise<RelationTarget[]> {
  const rows = await neo4jQuery<{ slug: string; name: string }>(`
    MATCH (i:Incident)
    RETURN i.slug AS slug,
           i.title + CASE WHEN i.date IS NOT NULL THEN ' · ' + i.date ELSE '' END AS name
    ORDER BY i.date DESC, i.title
  `)
  return rows
}

async function fetchOperationOptions(): Promise<RelationTarget[]> {
  const rows = await neo4jQuery<{ slug: string; name: string }>(`
    MATCH (op:Operation)
    RETURN op.slug AS slug, op.codeName AS name
    ORDER BY op.codeName
  `)
  return rows
}

async function fetchOrganizationOptions(): Promise<RelationTarget[]> {
  const rows = await neo4jQuery<{ slug: string; name: string }>(`
    MATCH (o:Organization)
    RETURN o.slug AS slug, o.canonicalName AS name
    ORDER BY o.canonicalName
  `)
  return rows
}

async function fetchUnitOptions(): Promise<RelationTarget[]> {
  const rows = await neo4jQuery<{ slug: string; name: string }>(`
    MATCH (u:Unit)
    RETURN u.slug AS slug, u.canonicalName AS name
    ORDER BY u.canonicalName
  `)
  return rows
}

async function fetchLocationOptions(): Promise<RelationTarget[]> {
  const rows = await neo4jQuery<{ slug: string; name: string }>(`
    MATCH (l:Location)
    RETURN l.slug AS slug, coalesce(l.canonicalName, l.title) AS name
    ORDER BY name
  `)
  return rows
}

async function fetchStationOptions(): Promise<RelationTarget[]> {
  const rows = await neo4jQuery<{ slug: string; name: string }>(`
    MATCH (s:Station)
    RETURN s.slug AS slug, coalesce(s.canonicalName, s.title) AS name
    ORDER BY name
  `)
  return rows
}

/**
 * Single-target edge strategy factory. Used for all six location/station
 * slots (Operation FROM/TO/FROM_STATION/TO_STATION + Incident AT/AT_STATION).
 * Each instance is a list strategy with 0..1 cardinality so RelationListEditor
 * works unchanged; saveEntries packs the first slug as the body field.
 *
 * `endpointPath(slug)` returns the URL path. `bodyField` is the JSON key
 * the backend expects ('locationSlug' | 'stationSlug'). `route` is the
 * targetRoute prefix.
 */
function singleEdgeStrategy(opts: {
  fetchTargets: () => Promise<RelationTarget[]>
  matchClause:  (slug: string) => string  // returns full Cypher with `target` props selected
  endpointPath: (parentSlug: string) => string
  bodyField:    'locationSlug' | 'stationSlug'
  routePrefix:  string
}): RelationStrategy {
  return {
    fetchTargets: opts.fetchTargets,
    async fetchEntries(parentSlug) {
      const rows = await neo4jQuery<HierarchyRow>(opts.matchClause(parentSlug), { slug: parentSlug })
      return rows.map(hierarchyRowToEntry)
    },
    async saveEntries(parentSlug, entries) {
      const targetSlug = entries[0]?.targetSlug ?? null
      const res = await authFetch(opts.endpointPath(parentSlug), {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ [opts.bodyField]: targetSlug }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
    },
    saveNote: noopSaveNote,
    targetRoute(entry) { return `${opts.routePrefix}/${entry.targetSlug}` },
  }
}

/* ── Operation location/station slots ─────────────────────────── */

export const OperationFromLocationStrategy = singleEdgeStrategy({
  fetchTargets: fetchLocationOptions,
  matchClause:  () => `
    MATCH (op:Operation {slug: $slug})-[:FROM]->(l:Location)
    RETURN l.slug AS targetSlug, coalesce(l.canonicalName, l.title) AS targetName
    LIMIT 1
  `,
  endpointPath: s => `/api/admin/operation/${encodeURIComponent(s)}/from-location`,
  bodyField:    'locationSlug',
  routePrefix:  '/location',
})

export const OperationToLocationStrategy = singleEdgeStrategy({
  fetchTargets: fetchLocationOptions,
  matchClause:  () => `
    MATCH (op:Operation {slug: $slug})-[:TO]->(l:Location)
    RETURN l.slug AS targetSlug, coalesce(l.canonicalName, l.title) AS targetName
    LIMIT 1
  `,
  endpointPath: s => `/api/admin/operation/${encodeURIComponent(s)}/to-location`,
  bodyField:    'locationSlug',
  routePrefix:  '/location',
})

export const OperationFromStationStrategy = singleEdgeStrategy({
  fetchTargets: fetchStationOptions,
  matchClause:  () => `
    MATCH (op:Operation {slug: $slug})-[:FROM_STATION]->(s:Station)
    RETURN s.slug AS targetSlug, coalesce(s.canonicalName, s.title) AS targetName
    LIMIT 1
  `,
  endpointPath: s => `/api/admin/operation/${encodeURIComponent(s)}/from-station`,
  bodyField:    'stationSlug',
  routePrefix:  '/station',
})

export const OperationToStationStrategy = singleEdgeStrategy({
  fetchTargets: fetchStationOptions,
  matchClause:  () => `
    MATCH (op:Operation {slug: $slug})-[:TO_STATION]->(s:Station)
    RETURN s.slug AS targetSlug, coalesce(s.canonicalName, s.title) AS targetName
    LIMIT 1
  `,
  endpointPath: s => `/api/admin/operation/${encodeURIComponent(s)}/to-station`,
  bodyField:    'stationSlug',
  routePrefix:  '/station',
})

/* ── Incident single AT slots ─────────────────────────────────── */

export const IncidentAtLocationStrategy = singleEdgeStrategy({
  fetchTargets: fetchLocationOptions,
  matchClause:  () => `
    MATCH (i:Incident {slug: $slug})-[:AT]->(l:Location)
    RETURN l.slug AS targetSlug, coalesce(l.canonicalName, l.title) AS targetName
    LIMIT 1
  `,
  endpointPath: s => `/api/admin/incident/${encodeURIComponent(s)}/at-location`,
  bodyField:    'locationSlug',
  routePrefix:  '/location',
})

export const IncidentAtStationStrategy = singleEdgeStrategy({
  fetchTargets: fetchStationOptions,
  matchClause:  () => `
    MATCH (i:Incident {slug: $slug})-[:AT_STATION]->(s:Station)
    RETURN s.slug AS targetSlug, coalesce(s.canonicalName, s.title) AS targetName
    LIMIT 1
  `,
  endpointPath: s => `/api/admin/incident/${encodeURIComponent(s)}/at-station`,
  bodyField:    'stationSlug',
  routePrefix:  '/station',
})

/** Children of an Incident — (parent:Incident)-[:RELATED_TO {kind:'contains'}]->(child:Incident). */
export const SubIncidentsStrategy: RelationStrategy = {
  fetchTargets: fetchIncidentOptions,
  async fetchEntries(parentSlug) {
    const rows = await neo4jQuery<HierarchyRow>(`
      MATCH (parent:Incident {slug: $slug})-[:RELATED_TO {kind:'contains'}]->(child:Incident)
      RETURN child.slug AS targetSlug, child.title AS targetName
      ORDER BY targetName
    `, { slug: parentSlug })
    return rows.map(hierarchyRowToEntry)
  },
  async saveEntries(parentSlug, entries) {
    const res = await authFetch(`/api/admin/incident/${encodeURIComponent(parentSlug)}/sub-incidents`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ children: entries.map(e => ({ incidentSlug: e.targetSlug })) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote: noopSaveNote,
  targetRoute(entry) { return `/events/${entry.targetSlug}` },
}

/** Children of an Operation — (parent:Operation)-[:RELATED_TO {kind:'contains'}]->(child:Operation). */
export const SubOperationsStrategy: RelationStrategy = {
  fetchTargets: fetchOperationOptions,
  async fetchEntries(parentSlug) {
    const rows = await neo4jQuery<HierarchyRow>(`
      MATCH (parent:Operation {slug: $slug})-[:RELATED_TO {kind:'contains'}]->(child:Operation)
      RETURN child.slug AS targetSlug, child.codeName AS targetName
      ORDER BY targetName
    `, { slug: parentSlug })
    return rows.map(hierarchyRowToEntry)
  },
  async saveEntries(parentSlug, entries) {
    const res = await authFetch(`/api/admin/operation/${encodeURIComponent(parentSlug)}/sub-operations`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ children: entries.map(e => ({ operationSlug: e.targetSlug })) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote: noopSaveNote,
  targetRoute(entry) { return `/events/${entry.targetSlug}` },
}

/** Incidents inside an Operation — (op:Operation)-[:RELATED_TO {kind:'contains'}]->(i:Incident). */
export const OperationIncidentsStrategy: RelationStrategy = {
  fetchTargets: fetchIncidentOptions,
  async fetchEntries(operationSlug) {
    const rows = await neo4jQuery<HierarchyRow>(`
      MATCH (op:Operation {slug: $slug})-[:RELATED_TO {kind:'contains'}]->(i:Incident)
      RETURN i.slug AS targetSlug,
             i.title + CASE WHEN i.date IS NOT NULL THEN ' · ' + i.date ELSE '' END AS targetName
      ORDER BY i.date, targetName
    `, { slug: operationSlug })
    return rows.map(hierarchyRowToEntry)
  },
  async saveEntries(operationSlug, entries) {
    const res = await authFetch(`/api/admin/operation/${encodeURIComponent(operationSlug)}/incidents`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidents: entries.map(e => ({ incidentSlug: e.targetSlug })) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote: noopSaveNote,
  targetRoute(entry) { return `/events/${entry.targetSlug}` },
}

/**
 * IncidentInOperationStrategy — the (single) parent Operation that contains
 * this Incident via RELATED_TO {kind:'contains'}. Modelled as a list
 * strategy with a 0-or-1 cardinality so it reuses RelationListEditor; the
 * backend takes a single operationSlug (or null to detach).
 */
export const IncidentInOperationStrategy: RelationStrategy = {
  fetchTargets: fetchOperationOptions,
  async fetchEntries(incidentSlug) {
    const rows = await neo4jQuery<HierarchyRow>(`
      MATCH (op:Operation)-[:RELATED_TO {kind:'contains'}]->(i:Incident {slug: $slug})
      RETURN op.slug AS targetSlug, op.codeName AS targetName
      LIMIT 1
    `, { slug: incidentSlug })
    return rows.map(hierarchyRowToEntry)
  },
  async saveEntries(incidentSlug, entries) {
    const opSlug = entries[0]?.targetSlug ?? null
    const res = await authFetch(`/api/admin/incident/${encodeURIComponent(incidentSlug)}/in-operation`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationSlug: opSlug }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote: noopSaveNote,
  targetRoute(entry) { return `/events/${entry.targetSlug}` },
}

/**
 * OperationOrganizationsStrategy — Organizations orchestrating an
 * Operation via ORCHESTRATED_BY. Multi-target list.
 */
export const OperationOrganizationsStrategy: RelationStrategy = {
  fetchTargets: fetchOrganizationOptions,
  async fetchEntries(operationSlug) {
    const rows = await neo4jQuery<HierarchyRow>(`
      MATCH (op:Operation {slug: $slug})-[:ORCHESTRATED_BY]->(o:Organization)
      RETURN o.slug AS targetSlug, o.canonicalName AS targetName
      ORDER BY targetName
    `, { slug: operationSlug })
    return rows.map(hierarchyRowToEntry)
  },
  async saveEntries(operationSlug, entries) {
    const res = await authFetch(`/api/admin/operation/${encodeURIComponent(operationSlug)}/organizations`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizations: entries.map(e => ({ organizationSlug: e.targetSlug })) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote: noopSaveNote,
  targetRoute(entry) { return `/organization/${entry.targetSlug}` },
}

/**
 * OperationUnitsStrategy — Units participating in an Operation via
 * (Unit)-[:PARTICIPATED_IN]->(Operation). Independent of orchestrating
 * orgs — RAF squadrons, Norwegian patrols, Wehrmacht pursuers can all
 * attach to the same op.
 */
export const OperationUnitsStrategy: RelationStrategy = {
  fetchTargets: fetchUnitOptions,
  async fetchEntries(operationSlug) {
    const rows = await neo4jQuery<HierarchyRow>(`
      MATCH (u:Unit)-[:PARTICIPATED_IN]->(op:Operation {slug: $slug})
      RETURN u.slug AS targetSlug, u.canonicalName AS targetName
      ORDER BY targetName
    `, { slug: operationSlug })
    return rows.map(hierarchyRowToEntry)
  },
  async saveEntries(operationSlug, entries) {
    const res = await authFetch(`/api/admin/operation/${encodeURIComponent(operationSlug)}/units`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ units: entries.map(e => ({ unitSlug: e.targetSlug })) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote: noopSaveNote,
  targetRoute(entry) { return `/district/${entry.targetSlug}` },
}

/**
 * OrganizationUnitsStrategy — PART_OF edges from Unit to Organization.
 * Used on OrganizationDetail to edit Underavdelinger. Edge carries role +
 * order. Description is modelled as a Description node owned by the
 * Organization:
 *   (o:Organization)-[:HAS_MEMBER_UNIT_NOTE]->(d:Description)-[:ABOUT_UNIT]->(u:Unit)
 * sourceRefs on existing edges are preserved by the backend (MERGE + SET
 * named fields only).
 */
interface UnitPartOfRow {
  targetSlug: string
  targetName: string
  role:       string | null
  order:      number | null
  sections:   SectionRow[] | null
}

function unitPartOfRowToEntry(r: UnitPartOfRow): RelationEntry {
  const sections = (r.sections ?? []).map(rowToSection)
  return {
    targetSlug:     r.targetSlug,
    targetName:     r.targetName,
    startDate:      null,
    endDate:        null,
    role:           r.role ?? null,
    order:          r.order ?? null,
    sections,
    hasDescription: sections.length > 0,
  }
}

export const OrganizationUnitsStrategy: RelationStrategy = {
  async fetchTargets() {
    const rows = await neo4jQuery<{ slug: string; name: string }>(`
      MATCH (u:Unit)
      RETURN u.slug AS slug, u.canonicalName AS name
      ORDER BY name
    `)
    return rows
  },
  async fetchEntries(orgSlug) {
    const rows = await neo4jQuery<UnitPartOfRow>(`
      MATCH (u:Unit)-[r:PART_OF]->(o:Organization {slug: $slug})
      OPTIONAL MATCH (o)-[:HAS_MEMBER_UNIT_NOTE]->(d:Description)-[:ABOUT_UNIT]->(u)
      OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
      WITH u, r, d, from
      OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
      WITH u, r, d, from,
           collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
      WITH u, r,
           CASE WHEN d IS NULL THEN NULL ELSE {
             order:     coalesce(d.order, 1),
             content:   d.content,
             citations: [x IN rawCites WHERE x IS NOT NULL],
             sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
               id:             from.id,
               title:          from.title,
               url:             from.url,
               authorFreeText: from.authorFreeText,
               license:        from.license,
               attribution:    from.attribution
             } END
           } END AS section
      WITH u, r, collect(section) AS rawSections
      RETURN u.slug          AS targetSlug,
             u.canonicalName AS targetName,
             r.role          AS role,
             r.order         AS \`order\`,
             [x IN rawSections WHERE x IS NOT NULL] AS sections
      ORDER BY CASE WHEN size([x IN rawSections WHERE x IS NOT NULL]) > 0 THEN 1 ELSE 0 END,
               coalesce(r.order, 999), targetName
    `, { slug: orgSlug })
    return rows.map(unitPartOfRowToEntry)
  },
  async saveEntries(orgSlug, entries) {
    const res = await authFetch(`/api/admin/organization/${encodeURIComponent(orgSlug)}/units`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        units: entries.map(e => ({
          unitSlug: e.targetSlug,
          role:     e.role ?? null,
          order:    typeof e.order === 'number' ? e.order : null,
        })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  async saveNote(orgSlug, unitSlug, sections) {
    const payload = {
      sections: [...sections].sort((a, b) => a.order - b.order).map(s => ({
        order:         s.order,
        content:       s.content,
        citations:     s.citations.map(c => ({ inline: c.inline, sourceId: c.source.id })),
        sourcedFromId: s.sourcedFrom?.id ?? null,
      })),
    }
    const res = await authFetch(
      `/api/admin/organization/${encodeURIComponent(orgSlug)}/member-unit-note/${encodeURIComponent(unitSlug)}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      },
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status} on note for ${unitSlug}`)
    }
  },
  targetRoute(entry) { return `/district/${entry.targetSlug}` },
}

/**
 * Editable strategies for the Organization page's "Operasjoner" /
 * "Hendelser" sections — manage the ORCHESTRATED_BY edge set from this
 * Org's child events.
 *
 * The "+ Opprett ny" affordance inside the picker jumps to
 * AdminEventNewView with `?forOrg=`, which creates the event AND wires
 * the edge in the same transaction.
 */
async function noteIsNoop(): Promise<void> { /* no description note on these edges */ }

export const OrgOperationsStrategy: RelationStrategy = {
  async fetchTargets() {
    const rows = await neo4jQuery<{ slug: string; name: string }>(`
      MATCH (op:Operation)
      RETURN op.slug AS slug, op.codeName AS name
      ORDER BY op.codeName
    `)
    return rows
  },
  async fetchEntries(orgSlug) {
    const rows = await neo4jQuery<{ targetSlug: string; targetName: string; date: string | null }>(`
      MATCH (op:Operation)-[:ORCHESTRATED_BY]->(o:Organization {slug: $slug})
      RETURN op.slug AS targetSlug, op.codeName AS targetName, op.date AS date
      ORDER BY op.codeName
    `, { slug: orgSlug })
    return rows.map(r => ({
      targetSlug:     r.targetSlug,
      targetName:     r.targetName,
      startDate:      r.date,
      endDate:        null,
      sections:       [],
      hasDescription: false,
    }))
  },
  async saveEntries(orgSlug, entries) {
    const res = await authFetch(`/api/admin/organization/${encodeURIComponent(orgSlug)}/operations`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: entries.map(e => ({ operationSlug: e.targetSlug })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote: noteIsNoop,
  targetRoute(entry) { return `/events/${entry.targetSlug}` },
}

export const OrgIncidentsStrategy: RelationStrategy = {
  async fetchTargets() {
    const rows = await neo4jQuery<{ slug: string; name: string }>(`
      MATCH (i:Incident)
      RETURN i.slug AS slug,
             i.title + CASE WHEN i.date IS NOT NULL THEN ' · ' + i.date ELSE '' END AS name
      ORDER BY i.date DESC, i.title
    `)
    return rows
  },
  async fetchEntries(orgSlug) {
    const rows = await neo4jQuery<{ targetSlug: string; targetName: string; date: string | null }>(`
      MATCH (i:Incident)-[:ORCHESTRATED_BY]->(o:Organization {slug: $slug})
      RETURN i.slug AS targetSlug, i.title AS targetName, i.date AS date
      ORDER BY i.date, i.title
    `, { slug: orgSlug })
    return rows.map(r => ({
      targetSlug:     r.targetSlug,
      targetName:     r.targetName,
      startDate:      r.date,
      endDate:        null,
      sections:       [],
      hasDescription: false,
    }))
  },
  async saveEntries(orgSlug, entries) {
    const res = await authFetch(`/api/admin/organization/${encodeURIComponent(orgSlug)}/incidents`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incidents: entries.map(e => ({ incidentSlug: e.targetSlug })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote: noteIsNoop,
  targetRoute(entry) { return `/events/${entry.targetSlug}` },
}

/**
 * Equipment pairing — (a:EquipmentType)-[:PAIRED_WITH]-(b:EquipmentType).
 * Symmetric: read in both directions, saved as one outgoing edge per pair
 * (the endpoint clears edges either way before recreating).
 */
export const EquipmentPairedStrategy: RelationStrategy = {
  async fetchTargets() {
    return neo4jQuery<RelationTarget>(`
      MATCH (e:EquipmentType) WHERE e.slug IS NOT NULL
      RETURN e.slug AS slug, trim(e.canonicalName) AS name
      ORDER BY name
    `)
  },
  async fetchEntries(parentSlug) {
    const rows = await neo4jQuery<HierarchyRow>(`
      MATCH (:EquipmentType {slug: $slug})-[:PAIRED_WITH]-(other:EquipmentType)
      RETURN DISTINCT other.slug AS targetSlug, trim(other.canonicalName) AS targetName
      ORDER BY targetName
    `, { slug: parentSlug })
    return rows.map(hierarchyRowToEntry)
  },
  async saveEntries(parentSlug, entries) {
    const res = await authFetch(`/api/admin/equipment/${encodeURIComponent(parentSlug)}/paired`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paired: entries.map(e => ({ equipmentSlug: e.targetSlug })) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
  },
  saveNote: noopSaveNote,
  targetRoute(entry) { return `/equipment/${entry.targetSlug}` },
}
