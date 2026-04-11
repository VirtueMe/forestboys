/**
 * Proof-of-concept: migrate events + related entities from Sanity → Neo4j.
 * Run with: npx tsx scripts/migrate-to-neo4j.ts
 *
 * Graph model:
 *   (Event)-[:INVOLVED]->(Person)
 *   (Event)-[:USED]->(Transport)
 *   (Event)-[:DEPARTED_FROM]->(Station)
 *   (Event)-[:ARRIVED_AT]->(Station)
 *   (Event)-[:ORIGIN]->(Location)
 *   (Event)-[:DESTINATION]->(Location)
 *   (Event)-[:ORGANISED_BY]->(Organization)
 *   (Event)-[:IN_DISTRICT]->(District)
 */

import neo4j from 'neo4j-driver'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env') })

const PROJECT_ID = '7r6kqtqy'
const DATASET    = 'production'
const CDN        = `https://${PROJECT_ID}.apicdn.sanity.io/v2021-08-31/data/query/${DATASET}`

// ── Sanity fetch ─────────────────────────────────────────────────────────────

async function fetchAll<T>(query: string): Promise<T[]> {
  let results: T[] = []
  let lastId = ''
  const pageSize = 500

  while (true) {
    const filter = lastId ? query.replace(']', ` && _id > "${lastId}"]`) : query
    const url = `${CDN}?query=${encodeURIComponent(`${filter} | order(_id asc) [0..${pageSize - 1}]`)}`
    const res  = await fetch(url)
    const json = await res.json() as { result: T[] }
    const page = json.result ?? []
    results = results.concat(page)
    if (page.length < pageSize) break
    lastId = (page[page.length - 1] as Record<string, unknown>)['_id'] as string
  }

  return results
}

// ── Main ─────────────────────────────────────────────────────────────────────

const driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
)

async function main() {
  const session = driver.session()

  try {
    console.log('Fetching events from Sanity…')
    const events = await fetchAll<Record<string, unknown>>(`*[_type == "event"]{
      _id,
      title,
      "slug": slug.current,
      date,
      "organization": organization->name,
      "district": district->name,
      "locationFrom": locationFrom->{_id, title, "slug": slug.current},
      "locationTo":   locationTo->{_id, title, "slug": slug.current},
      "stationFrom":  stationFrom->{_id, title, "slug": slug.current},
      "stationTo":    stationTo->{_id, title, "slug": slug.current},
      "people":    people[]->{_id, name, "slug": slug.current},
      "transport": transport[]->{_id, name, "slug": slug.current}
    }`)
    console.log(`  ${events.length} events fetched`)

    // ── Constraints (idempotent) ──────────────────────────────────────────────
    console.log('Creating constraints…')
    const constraints = [
      'CREATE CONSTRAINT event_slug IF NOT EXISTS FOR (e:Event) REQUIRE e.slug IS UNIQUE',
      'CREATE CONSTRAINT person_slug IF NOT EXISTS FOR (p:Person) REQUIRE p.slug IS UNIQUE',
      'CREATE CONSTRAINT transport_slug IF NOT EXISTS FOR (t:Transport) REQUIRE t.slug IS UNIQUE',
      'CREATE CONSTRAINT location_slug IF NOT EXISTS FOR (l:Location) REQUIRE l.slug IS UNIQUE',
      'CREATE CONSTRAINT station_slug IF NOT EXISTS FOR (s:Station) REQUIRE s.slug IS UNIQUE',
      'CREATE CONSTRAINT org_name IF NOT EXISTS FOR (o:Organization) REQUIRE o.name IS UNIQUE',
      'CREATE CONSTRAINT district_name IF NOT EXISTS FOR (d:District) REQUIRE d.name IS UNIQUE',
    ]
    for (const c of constraints) await session.run(c)

    // ── Migrate events ────────────────────────────────────────────────────────
    console.log('Migrating events…')
    let count = 0

    for (const event of events) {
      const tx = session.beginTransaction()
      const log: string[] = [`event:${String(event.slug)}`]

      try {
        // Event node
        await tx.run(
          `MERGE (e:Event {slug: $slug})
           SET e.title = $title, e.date = $date, e.sanityId = $id`,
          { slug: event.slug, title: event.title, date: event.date ?? null, id: event._id },
        )
        log.push(`  → Event(${String(event.slug)})`)

        // Organization
        if (event.organization) {
          await tx.run(
            `MERGE (o:Organization {name: $name})
             WITH o MATCH (e:Event {slug: $slug})
             MERGE (e)-[:ORGANISED_BY]->(o)`,
            { name: event.organization, slug: event.slug },
          )
          log.push(`  → Organization(${event.organization as string}) [:ORGANISED_BY]`)
        }

        // District
        if (event.district) {
          await tx.run(
            `MERGE (d:District {name: $name})
             WITH d MATCH (e:Event {slug: $slug})
             MERGE (e)-[:IN_DISTRICT]->(d)`,
            { name: event.district, slug: event.slug },
          )
          log.push(`  → District(${event.district as string}) [:IN_DISTRICT]`)
        }

        // locationFrom
        const locFrom = event.locationFrom as Record<string, string> | null
        if (locFrom?.slug) {
          await tx.run(
            `MERGE (l:Location {slug: $locSlug}) SET l.title = $title
             WITH l MATCH (e:Event {slug: $evSlug})
             MERGE (e)-[:ORIGIN]->(l)`,
            { locSlug: locFrom.slug, title: locFrom.title, evSlug: event.slug },
          )
          log.push(`  → Location(${locFrom.slug}) [:ORIGIN]`)
        }

        // locationTo
        const locTo = event.locationTo as Record<string, string> | null
        if (locTo?.slug) {
          await tx.run(
            `MERGE (l:Location {slug: $locSlug}) SET l.title = $title
             WITH l MATCH (e:Event {slug: $evSlug})
             MERGE (e)-[:DESTINATION]->(l)`,
            { locSlug: locTo.slug, title: locTo.title, evSlug: event.slug },
          )
          log.push(`  → Location(${locTo.slug}) [:DESTINATION]`)
        }

        // stationFrom
        const stFrom = event.stationFrom as Record<string, string> | null
        if (stFrom?.slug) {
          await tx.run(
            `MERGE (s:Station {slug: $stSlug}) SET s.title = $title
             WITH s MATCH (e:Event {slug: $evSlug})
             MERGE (e)-[:DEPARTED_FROM]->(s)`,
            { stSlug: stFrom.slug, title: stFrom.title, evSlug: event.slug },
          )
          log.push(`  → Station(${stFrom.slug}) [:DEPARTED_FROM]`)
        }

        // stationTo
        const stTo = event.stationTo as Record<string, string> | null
        if (stTo?.slug) {
          await tx.run(
            `MERGE (s:Station {slug: $stSlug}) SET s.title = $title
             WITH s MATCH (e:Event {slug: $evSlug})
             MERGE (e)-[:ARRIVED_AT]->(s)`,
            { stSlug: stTo.slug, title: stTo.title, evSlug: event.slug },
          )
          log.push(`  → Station(${stTo.slug}) [:ARRIVED_AT]`)
        }

        // People
        const people = (event.people ?? []) as Record<string, string>[]
        for (const person of people) {
          if (!person.slug) continue
          await tx.run(
            `MERGE (p:Person {slug: $slug}) SET p.name = $name
             WITH p MATCH (e:Event {slug: $evSlug})
             MERGE (e)-[:INVOLVED]->(p)`,
            { slug: person.slug, name: person.name, evSlug: event.slug },
          )
          log.push(`  → Person(${person.slug}) [:INVOLVED]`)
        }

        // Transport
        const transport = (event.transport ?? []) as Record<string, string>[]
        for (const t of transport) {
          if (!t.slug) continue
          await tx.run(
            `MERGE (t:Transport {slug: $slug}) SET t.name = $name
             WITH t MATCH (e:Event {slug: $evSlug})
             MERGE (e)-[:USED]->(t)`,
            { slug: t.slug, name: t.name, evSlug: event.slug },
          )
          log.push(`  → Transport(${t.slug}) [:USED]`)
        }

        await tx.commit()
        console.log(log.join('\n'))
        count++
        if (count % 100 === 0) console.log(`--- ${count} / ${events.length} ---`)
      } catch (err) {
        await tx.rollback()
        console.error(`Failed on event ${String(event.slug)}:`, err)
      }
    }

    console.log(`Done — ${count} events migrated.`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
