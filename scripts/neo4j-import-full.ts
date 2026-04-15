/**
 * Full import of all Sanity entities into Neo4j from local JSON snapshots.
 * Reads from data/sanity-*.json and data/sanity-event-meta.json.
 *
 * Run sanity-export.ts and sanity-analyze.ts first, then:
 *   npx tsx scripts/neo4j-import-full.ts
 *
 * Safe to re-run — uses MERGE so nothing is duplicated.
 *
 * Schema (Option B):
 *   Primary key on all nodes: sanityId (Sanity _id)
 *   slug kept as indexed property for URL routing
 *   district → (:Unit)
 *   Event-[:IN_DISTRICT]->District  → Event-[:PART_OF]->Unit
 *   Event-[:INVOLVED]->Person       → Person-[:PARTICIPATED_IN]->Event
 */

import { readFileSync } from 'fs'
import neo4j, { type Session } from 'neo4j-driver'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env') })

// ── Load local snapshots ──────────────────────────────────────────────────────

const dataDir = resolve(process.cwd(), 'data')
function load<T>(name: string): T[] {
  return JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8')) as T[]
}

type SanityDoc = Record<string, unknown>
type GeoPoint  = { _type: string; lat: number; lng: number; alt?: number }

const rawEvents    = load<SanityDoc>('sanity-event.json')
const rawLocations = load<SanityDoc>('sanity-location.json')
const rawStations  = load<SanityDoc>('sanity-station.json')
const rawPeople    = load<SanityDoc>('sanity-person.json')
const rawTransport = load<SanityDoc>('sanity-transport.json')
const rawOrgs      = load<SanityDoc>('sanity-organization.json')
const rawDistricts = load<SanityDoc>('sanity-district.json')

const eventMeta = load<{
  _id:             string
  group:           string
  sections:        Record<string, string>
  content:         string
  logEntries:      Array<{ date: string; text: string; type: string; offset: number }>
  mentionedPeople: Array<{ slug: string; name: string; section: string; confidence: 'high' | 'medium' }>
  startDate?:      string
  endDate?:        string
}>('sanity-event-meta.json')

const metaById = new Map(eventMeta.map(m => [m._id, m]))

const personMeta = load<{
  _id:        string
  slug:       string
  bornDate?:  string
  diedDate?:  string
  diedType?:  string
  logEntries: Array<{ date: string; text: string; type: string }>
}>('sanity-person-meta.json')

// Keyed by _id (= sanityId) for the new schema
const personMetaById = new Map(personMeta.map(m => [m._id, m]))

// Slug → _id for resolving text-extracted person mentions (mentionedPeople uses slugs)
const personIdBySlug = new Map(rawPeople.map(d => [slug(d), d['_id'] as string]))

// ── Section metadata ──────────────────────────────────────────────────────────

const SECTION_META: Record<string, { heading: string; importance: number }> = {
  oppdrag:        { heading: 'Oppdrag',        importance: 1 },
  personell:      { heading: 'Personell',      importance: 2 },
  deltakere:      { heading: 'Deltakere',      importance: 3 },
  tidsrommet:     { heading: 'Tidsrommet',     importance: 4 },
  arbeidsomraade: { heading: 'Arbeidsområde',  importance: 5 },
  resultat:       { heading: 'Resultat',       importance: 6 },
}

interface SectionRow {
  id:         string
  type:       string
  heading:    string
  body:       string
  importance: number
}

function buildSectionRows(
  evSlug: string,
  sections: Record<string, string> | undefined,
  content: string | undefined,
): SectionRow[] {
  const rows: SectionRow[] = []
  for (const [key, text] of Object.entries(sections ?? {})) {
    if (!text.trim()) continue
    const meta = SECTION_META[key] ?? { heading: key, importance: 98 }
    rows.push({ id: `${evSlug}::${key}`, type: key, heading: meta.heading, body: text.trim(), importance: meta.importance })
  }
  if (content?.trim()) {
    rows.push({ id: `${evSlug}::content`, type: 'content', heading: '', body: content.trim(), importance: 99 })
  }
  return rows.sort((a, b) => a.importance - b.importance)
}

interface LogEntryRow {
  id:   string
  date: string
  text: string
  type: string
}

// ── Location type classifier ──────────────────────────────────────────────────

function locationTypeOf(title: string): string | null {
  const t = title.toUpperCase()
  if (t.includes('LUFTWAFFE') || t.includes('FLUWA') || t.includes('STELLUNG') ||
      t.includes('BUNKER') || /\bFORT\b/.test(t) || t.includes('FESTNING'))  return 'GermanInstallation'
  if (t.startsWith('RAF ') || t.includes('AIRFIELD') || t.includes('AERODROME') ||
      t.includes('SJØFLYHAVN'))                                               return 'AlliedBase'
  if (/\bBA[\s\-_\d]/.test(t) || t.includes('BUVASSFARET') || t.includes('VASSFARET') ||
      t.includes('BASE ELG') || t.includes('BASE ORM') || t.includes('BREIESLEIREN') ||
      t.includes('EUREKA') || (t.includes('LEIR') && !t.includes('FANGELEIR')))  return 'ResistanceBase'
  if (t.includes('FANGELEIR'))  return 'PrisonerCamp'
  if (t.includes('HAVN') || t.includes('BRYGGE') || t.includes('KAI'))  return 'Harbour'
  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function geo(doc: SanityDoc): { lat: number; lng: number } | null {
  const c = doc['coordinates'] as GeoPoint | null
  if (c?.lat && c?.lng) return { lat: c.lat, lng: c.lng }
  return null
}

function slug(doc: SanityDoc): string {
  return ((doc['slug'] as SanityDoc)?.['current'] as string) ?? (doc['_id'] as string)
}

function ref(val: unknown): string | null {
  if (!val || typeof val !== 'object') return null
  return (val as SanityDoc)['_ref'] as string ?? null
}

// ── Batch helper ──────────────────────────────────────────────────────────────

async function batch(
  session: Session,
  label: string,
  docs: SanityDoc[],
  cypher: string,
  mapper: (d: SanityDoc) => Record<string, unknown>,
  size = 500,
) {
  let count = 0
  for (let i = 0; i < docs.length; i += size) {
    const chunk = docs.slice(i, i + size).map(mapper)
    await session.run(cypher, { rows: chunk })
    count += chunk.length
  }
  console.log(`  ${label.padEnd(16)} ${count}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

const driver = neo4j.driver(
  process.env['NEO4J_URI']!,
  neo4j.auth.basic(process.env['NEO4J_USERNAME']!, process.env['NEO4J_PASSWORD']!),
)

async function main() {
  const session = driver.session()

  try {
    // ── Constraints + indexes ──────────────────────────────────────────────────
    console.log('Ensuring constraints and indexes…')
    const ddl = [
      // Unique constraints on sanityId (primary key)
      'CREATE CONSTRAINT event_sanity_id     IF NOT EXISTS FOR (e:Event)        REQUIRE e.sanityId IS UNIQUE',
      'CREATE CONSTRAINT person_sanity_id    IF NOT EXISTS FOR (p:Person)       REQUIRE p.sanityId IS UNIQUE',
      'CREATE CONSTRAINT transport_sanity_id IF NOT EXISTS FOR (t:Transport)    REQUIRE t.sanityId IS UNIQUE',
      'CREATE CONSTRAINT location_sanity_id  IF NOT EXISTS FOR (l:Location)     REQUIRE l.sanityId IS UNIQUE',
      'CREATE CONSTRAINT station_sanity_id   IF NOT EXISTS FOR (s:Station)      REQUIRE s.sanityId IS UNIQUE',
      'CREATE CONSTRAINT org_sanity_id       IF NOT EXISTS FOR (o:Organization) REQUIRE o.sanityId IS UNIQUE',
      'CREATE CONSTRAINT unit_sanity_id      IF NOT EXISTS FOR (u:Unit)         REQUIRE u.sanityId IS UNIQUE',
      'CREATE CONSTRAINT section_id          IF NOT EXISTS FOR (s:Section)      REQUIRE s.id IS UNIQUE',
      'CREATE CONSTRAINT log_entry_id        IF NOT EXISTS FOR (l:LogEntry)     REQUIRE l.id IS UNIQUE',
      // Indexes on slug for URL routing
      'CREATE INDEX event_slug     IF NOT EXISTS FOR (e:Event)     ON (e.slug)',
      'CREATE INDEX person_slug    IF NOT EXISTS FOR (p:Person)    ON (p.slug)',
      'CREATE INDEX location_slug  IF NOT EXISTS FOR (l:Location)  ON (l.slug)',
      'CREATE INDEX station_slug   IF NOT EXISTS FOR (s:Station)   ON (s.slug)',
      'CREATE INDEX transport_slug IF NOT EXISTS FOR (t:Transport) ON (t.slug)',
    ]
    for (const c of ddl) await session.run(c)

    // ── Reference nodes ────────────────────────────────────────────────────────
    console.log('\nImporting reference nodes…')

    await batch(session, 'Organization', rawOrgs,
      `UNWIND $rows AS row
       MERGE (o:Organization {sanityId: row.id})
       SET o.name  = row.name,
           o.color = row.color`,
      d => ({
        id:    d['_id'] as string,
        name:  d['name'] as string,
        color: ((d['color'] as SanityDoc)?.['hex'] as string) ?? null,
      }),
    )

    await batch(session, 'Unit', rawDistricts,
      `UNWIND $rows AS row
       MERGE (u:Unit {sanityId: row.id})
       SET u.name = row.name`,
      d => ({ id: d['_id'] as string, name: d['name'] as string }),
    )

    await batch(session, 'Location', rawLocations,
      `UNWIND $rows AS row
       MERGE (l:Location {sanityId: row.id})
       SET l.title        = row.title,
           l.slug         = row.slug,
           l.lat          = row.lat,
           l.lng          = row.lng,
           l.locationType = row.locationType`,
      d => {
        const coords = geo(d)
        return {
          id:           d['_id'] as string,
          slug:         slug(d),
          title:        d['title'] as string,
          lat:          coords?.lat ?? null,
          lng:          coords?.lng ?? null,
          locationType: locationTypeOf(d['title'] as string),
        }
      },
    )

    await batch(session, 'Station', rawStations,
      `UNWIND $rows AS row
       MERGE (s:Station {sanityId: row.id})
       SET s.title = row.title,
           s.slug  = row.slug,
           s.type  = row.type,
           s.lat   = row.lat,
           s.lng   = row.lng`,
      d => {
        const coords = geo(d)
        return {
          id:    d['_id'] as string,
          slug:  slug(d),
          title: d['title'] as string,
          type:  (d['type'] as string) ?? null,
          lat:   coords?.lat ?? null,
          lng:   coords?.lng ?? null,
        }
      },
    )

    await batch(session, 'Person', rawPeople,
      `UNWIND $rows AS row
       MERGE (p:Person {sanityId: row.id})
       SET p.name       = row.name,
           p.slug       = row.slug,
           p.secretName = row.secretName,
           p.birthYear  = row.birthYear,
           p.home       = row.home,
           p.bornDate   = row.bornDate,
           p.diedDate   = row.diedDate,
           p.diedType   = row.diedType`,
      d => {
        const meta = personMetaById.get(d['_id'] as string)
        return {
          id:         d['_id'] as string,
          slug:       slug(d),
          name:       d['name'] as string,
          secretName: (d['secretName'] as string) ?? null,
          birthYear:  (d['birthYear'] as number) ?? null,
          home:       (d['home'] as string) ?? null,
          bornDate:   meta?.bornDate ?? null,
          diedDate:   meta?.diedDate ?? null,
          diedType:   meta?.diedType ?? null,
        }
      },
    )

    // Person log entries
    console.log('Importing person log entries…')
    for (const meta of personMeta) {
      if (!meta.logEntries.length) continue
      const tx = session.beginTransaction()
      try {
        await tx.run(
          `MATCH (p:Person {sanityId: $id})-[:HAS_LOG_ENTRY]->(l:PersonLogEntry) DETACH DELETE l`,
          { id: meta._id },
        )
        for (const entry of meta.logEntries) {
          await tx.run(
            `MATCH (p:Person {sanityId: $id})
             CREATE (l:PersonLogEntry { date: $date, text: $text, type: $type })
             MERGE (p)-[:HAS_LOG_ENTRY]->(l)`,
            { id: meta._id, date: entry.date, text: entry.text, type: entry.type },
          )
        }
        await tx.commit()
      } catch (err) {
        await tx.rollback()
        console.warn(`  failed log entries for ${meta.slug}:`, err)
      }
    }

    await batch(session, 'Transport', rawTransport,
      `UNWIND $rows AS row
       MERGE (t:Transport {sanityId: row.id})
       SET t.name   = row.name,
           t.slug   = row.slug,
           t.type   = row.type,
           t.unit   = row.unit,
           t.regser = row.regser`,
      d => ({
        id:     d['_id'] as string,
        slug:   slug(d),
        name:   d['name'] as string,
        type:   (d['type'] as string) ?? null,
        unit:   (d['unit'] as string) ?? null,
        regser: (d['regser'] as string) ?? null,
      }),
    )

    // ── Events ─────────────────────────────────────────────────────────────────
    console.log('\nImporting events…')
    let eventCount = 0
    let relCount   = 0
    let failed     = 0

    for (const event of rawEvents) {
      const evId   = event['_id'] as string
      const evSlug = slug(event)
      const meta   = metaById.get(evId)
      const tx     = session.beginTransaction()

      try {
        // Event node
        await tx.run(
          `MERGE (e:Event {sanityId: $id})
           SET e.title     = $title,
               e.slug      = $slug,
               e.date      = $date,
               e.group     = $group,
               e.startDate = $startDate,
               e.endDate   = $endDate`,
          {
            id:        evId,
            slug:      evSlug,
            title:     event['title'] as string,
            date:      (event['date'] as string) ?? null,
            group:     meta?.group ?? 'Unknown',
            startDate: meta?.startDate ?? null,
            endDate:   meta?.endDate   ?? null,
          },
        )

        // Section nodes
        const sectionRows = buildSectionRows(evSlug, meta?.sections, meta?.content)
        if (sectionRows.length) {
          await tx.run(
            `MATCH (e:Event {sanityId: $evId})
             UNWIND $rows AS row
             MERGE (s:Section {id: row.id})
             SET s.type       = row.type,
                 s.heading    = row.heading,
                 s.body       = row.body,
                 s.importance = row.importance
             MERGE (e)-[:HAS_SECTION]->(s)`,
            { evId, rows: sectionRows },
          )
          relCount += sectionRows.length
        }

        // LogEntry nodes
        const logRows: LogEntryRow[] = (meta?.logEntries ?? []).map(le => ({
          id:   `${evSlug}::log::${le.date}::${le.offset}`,
          date: le.date,
          text: le.text,
          type: le.type,
        }))
        await tx.run(
          `MATCH (e:Event {sanityId: $evId})-[:HAS_LOG_ENTRY]->(l:LogEntry)
           WHERE NOT l.id IN $ids
           DETACH DELETE l`,
          { evId, ids: logRows.map(r => r.id) },
        )
        if (logRows.length) {
          await tx.run(
            `MATCH (e:Event {sanityId: $evId})
             UNWIND $rows AS row
             MERGE (l:LogEntry {id: row.id})
             SET l.date = row.date, l.text = row.text, l.type = row.type
             MERGE (e)-[:HAS_LOG_ENTRY]->(l)`,
            { evId, rows: logRows },
          )
          relCount += logRows.length
        }

        // Organization — _ref IS the sanityId
        const orgId = ref(event['organization'])
        if (orgId) {
          await tx.run(
            `MATCH (e:Event {sanityId: $evId}), (o:Organization {sanityId: $orgId})
             MERGE (e)-[:ORGANISED_BY]->(o)`,
            { evId, orgId },
          )
          relCount++
        }

        // Unit (was District) — _ref IS the sanityId
        const unitId = ref(event['district'])
        if (unitId) {
          await tx.run(
            `MATCH (e:Event {sanityId: $evId}), (u:Unit {sanityId: $unitId})
             MERGE (e)-[:PART_OF]->(u)`,
            { evId, unitId },
          )
          relCount++
        }

        // locationFrom / locationTo
        for (const [field, rel] of [['locationFrom', 'ORIGIN'], ['locationTo', 'DESTINATION']] as const) {
          const locId = ref(event[field])
          if (locId) {
            await tx.run(
              `MATCH (e:Event {sanityId: $evId}), (l:Location {sanityId: $locId})
               MERGE (e)-[:${rel}]->(l)`,
              { evId, locId },
            )
            relCount++
          }
        }

        // stationFrom / stationTo
        for (const [field, rel] of [['stationFrom', 'DEPARTED_FROM'], ['stationTo', 'ARRIVED_AT']] as const) {
          const stId = ref(event[field])
          if (stId) {
            await tx.run(
              `MATCH (e:Event {sanityId: $evId}), (s:Station {sanityId: $stId})
               MERGE (e)-[:${rel}]->(s)`,
              { evId, stId },
            )
            relCount++
          }
        }

        // People — structured refs (Person→Event direction)
        const people = (event['people'] ?? []) as SanityDoc[]
        for (const person of people) {
          const pId = ref(person)
          if (!pId) continue
          await tx.run(
            `MATCH (e:Event {sanityId: $evId}), (p:Person {sanityId: $pId})
             MERGE (p)-[:PARTICIPATED_IN]->(e)`,
            { evId, pId },
          )
          relCount++
        }

        // People — text-extracted mentions (resolve slug → sanityId)
        for (const mention of (meta?.mentionedPeople ?? [])) {
          const pId = personIdBySlug.get(mention.slug)
          if (!pId) continue
          await tx.run(
            `MATCH (e:Event {sanityId: $evId}), (p:Person {sanityId: $pId})
             MERGE (p)-[:PARTICIPATED_IN]->(e)`,
            { evId, pId },
          )
          relCount++
        }

        // Transport
        const transport = (event['transport'] ?? []) as SanityDoc[]
        for (const t of transport) {
          const tId = ref(t)
          if (!tId) continue
          await tx.run(
            `MATCH (e:Event {sanityId: $evId}), (t:Transport {sanityId: $tId})
             MERGE (e)-[:USED]->(t)`,
            { evId, tId },
          )
          relCount++
        }

        await tx.commit()
        eventCount++
        if (eventCount % 500 === 0) console.log(`  … ${eventCount} / ${rawEvents.length} events`)
      } catch (err) {
        await tx.rollback()
        console.error(`  Failed: ${evSlug}`, err)
        failed++
      }
    }

    // ── Summary ────────────────────────────────────────────────────────────────
    console.log(`\n── Done ───────────────────────────────────────────────────────────`)
    console.log(`  Organizations  ${rawOrgs.length}`)
    console.log(`  Units          ${rawDistricts.length}`)
    console.log(`  Locations      ${rawLocations.length}`)
    console.log(`  Stations       ${rawStations.length}`)
    console.log(`  People         ${rawPeople.length}`)
    console.log(`  Transport      ${rawTransport.length}`)
    console.log(`  Events         ${eventCount} / ${rawEvents.length}  (${failed} failed)`)
    console.log(`  Relationships  ${relCount}`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
