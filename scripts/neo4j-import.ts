/**
 * Step 2: Read data/sanity-events.json and import into Neo4j.
 * Run with: npx tsx scripts/neo4j-import.ts
 *
 * Safe to re-run — uses MERGE so nothing is duplicated.
 */

import { readFileSync } from 'fs'
import neo4j from 'neo4j-driver'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env') })

// Read from file argument or stdin
async function readInput(): Promise<Record<string, unknown>[]> {
  const file = process.argv[2]
  if (file) return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>[]
  return new Promise(resolve => {
    let raw = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    process.stdin.on('end', () => { resolve(JSON.parse(raw) as Record<string, unknown>[]) })
  })
}

const events = await readInput()

const driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
)

async function main() {
  const session = driver.session()

  try {
    // ── Constraints (idempotent) ──────────────────────────────────────────────
    console.log('Ensuring constraints…')
    const constraints = [
      'CREATE CONSTRAINT event_slug     IF NOT EXISTS FOR (e:Event)        REQUIRE e.slug IS UNIQUE',
      'CREATE CONSTRAINT person_slug    IF NOT EXISTS FOR (p:Person)       REQUIRE p.slug IS UNIQUE',
      'CREATE CONSTRAINT transport_slug IF NOT EXISTS FOR (t:Transport)    REQUIRE t.slug IS UNIQUE',
      'CREATE CONSTRAINT location_slug  IF NOT EXISTS FOR (l:Location)     REQUIRE l.slug IS UNIQUE',
      'CREATE CONSTRAINT station_slug   IF NOT EXISTS FOR (s:Station)      REQUIRE s.slug IS UNIQUE',
      'CREATE CONSTRAINT org_name       IF NOT EXISTS FOR (o:Organization) REQUIRE o.name IS UNIQUE',
      'CREATE CONSTRAINT district_name  IF NOT EXISTS FOR (d:District)     REQUIRE d.name IS UNIQUE',
    ]
    for (const c of constraints) await session.run(c)

    // ── Import ────────────────────────────────────────────────────────────────
    console.log(`Importing ${events.length} events…\n`)
    let count = 0

    for (const event of events) {
      const tx  = session.beginTransaction()
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
        if (count % 100 === 0) console.log(`\n--- ${count} / ${events.length} ---\n`)
      } catch (err) {
        await tx.rollback()
        console.error(`Failed on event ${String(event.slug)}:`, err)
      }
    }

    console.log(`\nDone — ${count} / ${events.length} events imported.`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
