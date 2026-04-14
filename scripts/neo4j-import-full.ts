/**
 * Full import of all Sanity entities into Neo4j from local JSON snapshots.
 * Reads from data/sanity-*.json and data/sanity-event-meta.json.
 *
 * Run sanity-export.ts and sanity-analyze.ts first, then:
 *   npx tsx scripts/neo4j-import-full.ts
 *
 * Safe to re-run — uses MERGE so nothing is duplicated.
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

type SanityDoc  = Record<string, unknown>
type GeoPoint   = { _type: string; lat: number; lng: number; alt?: number }

const rawEvents    = load<SanityDoc>('sanity-event.json')
const rawLocations = load<SanityDoc>('sanity-location.json')
const rawStations  = load<SanityDoc>('sanity-station.json')
const rawPeople    = load<SanityDoc>('sanity-person.json')
const rawTransport = load<SanityDoc>('sanity-transport.json')
const rawOrgs      = load<SanityDoc>('sanity-organization.json')
const rawDistricts = load<SanityDoc>('sanity-district.json')
const eventMeta    = load<{
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

const personMetaBySlug = new Map(personMeta.map(m => [m.slug, m]))

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
  id: string         // eventSlug::type — stable merge key
  type: string
  heading: string
  body: string
  importance: number
}

/** Convert sections map + content → ordered SectionRow array */
function buildSectionRows(
  evSlug: string,
  sections: Record<string, string> | undefined,
  content: string | undefined,
): SectionRow[] {
  const rows: SectionRow[] = []

  // Named sections
  for (const [key, text] of Object.entries(sections ?? {})) {
    if (!text.trim()) continue
    const meta = SECTION_META[key] ?? { heading: key, importance: 98 }
    rows.push({
      id:         `${evSlug}::${key}`,
      type:       key,
      heading:    meta.heading,
      body:       text.trim(),
      importance: meta.importance,
    })
  }

  // Uncategorized content — stored last, no heading
  if (content?.trim()) {
    rows.push({
      id:         `${evSlug}::content`,
      type:       'content',
      heading:    '',
      body:       content.trim(),
      importance: 99,
    })
  }

  return rows.sort((a, b) => a.importance - b.importance)
}

interface LogEntryRow {
  id:   string   // eventSlug::log::date::charOffset — stable content+position key
  date: string
  text: string
  type: string   // 'report' | 'arrest'
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
  if (t.includes('FANGELEIR'))                                                return 'PrisonerCamp'
  if (t.includes('HAVN') || t.includes('BRYGGE') || t.includes('KAI'))      return 'Harbour'
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

// ── ID lookup maps (resolved after entities are defined) ──────────────────────

const locationSlugById  = new Map(rawLocations.map(d => [d['_id'] as string, slug(d)]))
const stationSlugById   = new Map(rawStations.map(d =>  [d['_id'] as string, slug(d)]))
const personSlugById    = new Map(rawPeople.map(d =>    [d['_id'] as string, slug(d)]))
const transportSlugById = new Map(rawTransport.map(d => [d['_id'] as string, slug(d)]))
const orgNameById       = new Map(rawOrgs.map(d =>      [d['_id'] as string, d['name'] as string]))
const districtNameById  = new Map(rawDistricts.map(d => [d['_id'] as string, d['name'] as string]))

async function batch(session: Session, label: string, docs: SanityDoc[], cypher: string, mapper: (d: SanityDoc) => Record<string, unknown>, size = 500) {
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
    // ── Constraints ────────────────────────────────────────────────────────────
    console.log('Ensuring constraints…')
    const constraints = [
      'CREATE CONSTRAINT event_slug     IF NOT EXISTS FOR (e:Event)        REQUIRE e.slug IS UNIQUE',
      'CREATE CONSTRAINT person_slug    IF NOT EXISTS FOR (p:Person)       REQUIRE p.slug IS UNIQUE',
      'CREATE CONSTRAINT transport_slug IF NOT EXISTS FOR (t:Transport)    REQUIRE t.slug IS UNIQUE',
      'CREATE CONSTRAINT location_slug  IF NOT EXISTS FOR (l:Location)     REQUIRE l.slug IS UNIQUE',
      'CREATE CONSTRAINT station_slug   IF NOT EXISTS FOR (s:Station)      REQUIRE s.slug IS UNIQUE',
      'CREATE CONSTRAINT org_name       IF NOT EXISTS FOR (o:Organization) REQUIRE o.name IS UNIQUE',
      'CREATE CONSTRAINT district_name  IF NOT EXISTS FOR (d:District)     REQUIRE d.name IS UNIQUE',
      'CREATE CONSTRAINT section_id     IF NOT EXISTS FOR (s:Section)      REQUIRE s.id IS UNIQUE',
      'CREATE CONSTRAINT log_entry_id   IF NOT EXISTS FOR (l:LogEntry)     REQUIRE l.id IS UNIQUE',
    ]
    for (const c of constraints) await session.run(c)

    // ── Reference nodes ────────────────────────────────────────────────────────
    console.log('\nImporting reference nodes…')

    await batch(session, 'Organization', rawOrgs,
      `UNWIND $rows AS row MERGE (o:Organization {name: row.name}) SET o.color = row.color`,
      d => ({ name: d['name'] as string, color: ((d['color'] as SanityDoc)?.['hex'] as string) ?? null }),
    )

    await batch(session, 'District', rawDistricts,
      `UNWIND $rows AS row MERGE (d:District {name: row.name})`,
      d => ({ name: d['name'] as string }),
    )

    await batch(session, 'Location', rawLocations,
      `UNWIND $rows AS row
       MERGE (l:Location {slug: row.slug})
       SET l.title       = row.title,
           l.sanityId    = row.id,
           l.lat         = row.lat,
           l.lng         = row.lng,
           l.locationType = row.locationType`,
      d => {
        const coords = geo(d)
        return {
          slug:         slug(d),
          title:        d['title'] as string,
          id:           d['_id'] as string,
          lat:          coords?.lat ?? null,
          lng:          coords?.lng ?? null,
          locationType: locationTypeOf(d['title'] as string),
        }
      },
    )

    await batch(session, 'Station', rawStations,
      `UNWIND $rows AS row
       MERGE (s:Station {slug: row.slug})
       SET s.title    = row.title,
           s.sanityId = row.id,
           s.type     = row.type,
           s.lat      = row.lat,
           s.lng      = row.lng`,
      d => {
        const coords = geo(d)
        return {
          slug:  slug(d),
          title: d['title'] as string,
          id:    d['_id'] as string,
          type:  d['type'] as string ?? null,
          lat:   coords?.lat ?? null,
          lng:   coords?.lng ?? null,
        }
      },
    )

    await batch(session, 'Person', rawPeople,
      `UNWIND $rows AS row
       MERGE (p:Person {slug: row.slug})
       SET p.name       = row.name,
           p.sanityId   = row.id,
           p.secretName = row.secretName,
           p.birthYear  = row.birthYear,
           p.home       = row.home,
           p.bornDate   = row.bornDate,
           p.diedDate   = row.diedDate,
           p.diedType   = row.diedType`,
      d => {
        const pSlug = slug(d)
        const meta  = personMetaBySlug.get(pSlug)
        return {
          slug:       pSlug,
          name:       d['name'] as string,
          id:         d['_id'] as string,
          secretName: d['secretName'] as string ?? null,
          birthYear:  d['birthYear'] as number ?? null,
          home:       d['home'] as string ?? null,
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
        // Clear old log entries for this person
        await tx.run(
          `MATCH (p:Person {slug: $slug})-[:HAS_LOG_ENTRY]->(l:PersonLogEntry) DETACH DELETE l`,
          { slug: meta.slug },
        )
        for (const entry of meta.logEntries) {
          await tx.run(
            `MATCH (p:Person {slug: $slug})
             CREATE (l:PersonLogEntry { date: $date, text: $text, type: $type })
             MERGE (p)-[:HAS_LOG_ENTRY]->(l)`,
            { slug: meta.slug, date: entry.date, text: entry.text, type: entry.type },
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
       MERGE (t:Transport {slug: row.slug})
       SET t.name   = row.name,
           t.sanityId = row.id,
           t.type   = row.type,
           t.unit   = row.unit,
           t.regser = row.regser`,
      d => ({
        slug:  slug(d),
        name:  d['name'] as string,
        id:    d['_id'] as string,
        type:  d['type'] as string ?? null,
        unit:  d['unit'] as string ?? null,
        regser: d['regser'] as string ?? null,
      }),
    )

    // ── Events ─────────────────────────────────────────────────────────────────
    console.log('\nImporting events…')
    let eventCount = 0
    let relCount   = 0
    let failed     = 0

    for (const event of rawEvents) {
      const meta  = metaById.get(event['_id'] as string)
      const evSlug = slug(event)
      const tx    = session.beginTransaction()

      try {
        // Event node
        await tx.run(
          `MERGE (e:Event {slug: $slug})
           SET e.title     = $title,
               e.date      = $date,
               e.sanityId  = $id,
               e.group     = $group,
               e.startDate = $startDate,
               e.endDate   = $endDate`,
          {
            slug:      evSlug,
            title:     event['title'] as string,
            date:      (event['date'] as string) ?? null,
            id:        event['_id'] as string,
            group:     meta?.group ?? 'Unknown',
            startDate: meta?.startDate ?? null,
            endDate:   meta?.endDate   ?? null,
          },
        )

        // Section nodes (named sections + uncategorized content)
        const sectionRows = buildSectionRows(evSlug, meta?.sections, meta?.content)
        if (sectionRows.length) {
          await tx.run(
            `MATCH (e:Event {slug: $evSlug})
             UNWIND $rows AS row
             MERGE (s:Section {id: row.id})
             SET s.type       = row.type,
                 s.heading    = row.heading,
                 s.body       = row.body,
                 s.importance = row.importance
             MERGE (e)-[:HAS_SECTION]->(s)`,
            { evSlug, rows: sectionRows },
          )
          relCount += sectionRows.length
        }

        // LogEntry nodes — delete stale entries first, then recreate
        const logRows: LogEntryRow[] = (meta?.logEntries ?? []).map(le => ({
          id:   `${evSlug}::log::${le.date}::${le.offset}`,
          date: le.date,
          text: le.text,
          type: le.type,
        }))
        // Remove any LogEntry nodes for this event that are NOT in the current set
        // (handles deduplication: stale nodes from old positional indices are cleaned up)
        await tx.run(
          `MATCH (e:Event {slug: $evSlug})-[:HAS_LOG_ENTRY]->(l:LogEntry)
           WHERE NOT l.id IN $ids
           DETACH DELETE l`,
          { evSlug, ids: logRows.map(r => r.id) },
        )
        if (logRows.length) {
          await tx.run(
            `MATCH (e:Event {slug: $evSlug})
             UNWIND $rows AS row
             MERGE (l:LogEntry {id: row.id})
             SET l.date = row.date,
                 l.text = row.text,
                 l.type = row.type
             MERGE (e)-[:HAS_LOG_ENTRY]->(l)`,
            { evSlug, rows: logRows },
          )
          relCount += logRows.length
        }

        // Organization
        const orgName = orgNameById.get(ref(event['organization']) ?? '')
        if (orgName) {
          await tx.run(
            `MATCH (e:Event {slug: $slug}), (o:Organization {name: $name})
             MERGE (e)-[:ORGANISED_BY]->(o)`,
            { slug: evSlug, name: orgName },
          )
          relCount++
        }

        // District
        const districtName = districtNameById.get(ref(event['district']) ?? '')
        if (districtName) {
          await tx.run(
            `MATCH (e:Event {slug: $slug}), (d:District {name: $name})
             MERGE (e)-[:IN_DISTRICT]->(d)`,
            { slug: evSlug, name: districtName },
          )
          relCount++
        }

        // locationFrom / locationTo
        for (const [field, rel] of [['locationFrom', 'ORIGIN'], ['locationTo', 'DESTINATION']] as const) {
          const locSlug = locationSlugById.get(ref(event[field]) ?? '')
          if (locSlug) {
            await tx.run(
              `MATCH (e:Event {slug: $evSlug}), (l:Location {slug: $locSlug})
               MERGE (e)-[:${rel}]->(l)`,
              { evSlug, locSlug },
            )
            relCount++
          }
        }

        // stationFrom / stationTo
        for (const [field, rel] of [['stationFrom', 'DEPARTED_FROM'], ['stationTo', 'ARRIVED_AT']] as const) {
          const stSlug = stationSlugById.get(ref(event[field]) ?? '')
          if (stSlug) {
            await tx.run(
              `MATCH (e:Event {slug: $evSlug}), (s:Station {slug: $stSlug})
               MERGE (e)-[:${rel}]->(s)`,
              { evSlug, stSlug },
            )
            relCount++
          }
        }

        // People — structured refs from Sanity
        const people = (event['people'] ?? []) as SanityDoc[]
        for (const person of people) {
          const pSlug = personSlugById.get(ref(person) ?? '')
          if (!pSlug) continue
          await tx.run(
            `MATCH (e:Event {slug: $evSlug}), (p:Person {slug: $pSlug})
             MERGE (e)-[:INVOLVED]->(p)`,
            { evSlug, pSlug },
          )
          relCount++
        }

        // People — text-extracted mentions from description sections
        for (const mention of (meta?.mentionedPeople ?? [])) {
          await tx.run(
            `MATCH (e:Event {slug: $evSlug}), (p:Person {slug: $pSlug})
             MERGE (e)-[:INVOLVED]->(p)`,
            { evSlug, pSlug: mention.slug },
          )
          relCount++
        }

        // Transport
        const transport = (event['transport'] ?? []) as SanityDoc[]
        for (const t of transport) {
          const tSlug = transportSlugById.get(ref(t) ?? '')
          if (!tSlug) continue
          await tx.run(
            `MATCH (e:Event {slug: $evSlug}), (t:Transport {slug: $tSlug})
             MERGE (e)-[:USED]->(t)`,
            { evSlug, tSlug },
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
    console.log(`\n── Done ──────────────────────────────────────────────────────────`)
    console.log(`  Organizations  ${rawOrgs.length}`)
    console.log(`  Districts      ${rawDistricts.length}`)
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
