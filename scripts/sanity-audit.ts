/**
 * Data quality audit — queries Neo4j for structural gaps and cross-references
 * findings with sanity-event-meta.json. Writes data/audit-report.json.
 *
 * Run with: npx tsx scripts/sanity-audit.ts
 * Requires NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD in .env
 */

import { writeFileSync, readFileSync } from 'fs'
import { resolve } from 'path'
import neo4j from 'neo4j-driver'
import 'dotenv/config'

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = 'error' | 'warning' | 'info'

interface Finding {
  type:       string
  severity:   Severity
  eventSlug:  string
  eventTitle: string
  message:    string
  data?:      Record<string, unknown>
}

interface EventMeta {
  _id:    string
  slug:   string
  title:  string
  group:  string
  issues: string[]
  logEntries: Array<{ date: string; text: string; type: string }>
}

// ── Neo4j ─────────────────────────────────────────────────────────────────────

const driver = neo4j.driver(
  process.env['NEO4J_URI']!,
  neo4j.auth.basic(process.env['NEO4J_USERNAME']!, process.env['NEO4J_PASSWORD']!),
  { disableLosslessIntegers: true },
)

async function query<T>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const result = await session.run(cypher, params)
    return result.records.map(r => r.toObject() as T)
  } finally {
    await session.close()
  }
}

// ── Local data ────────────────────────────────────────────────────────────────

const eventMeta = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/sanity-event-meta.json'), 'utf-8'),
) as EventMeta[]

// ── Audit checks ──────────────────────────────────────────────────────────────

const findings: Finding[] = []

function add(f: Finding) { findings.push(f) }

console.log('Running audit checks…\n')

// ── 1. Events with no date ─────────────────────────────────────────────────
{
  const rows = await query<{ slug: string; title: string }>(
    `MATCH (e:Event) WHERE e.date IS NULL RETURN e.slug AS slug, e.title AS title`,
  )
  for (const r of rows) {
    add({ type: 'no-date', severity: 'error', eventSlug: r.slug, eventTitle: r.title,
      message: 'Event has no date' })
  }
  console.log(`no-date             ${rows.length}`)
}

// ── 2. Events with no people ───────────────────────────────────────────────
{
  const rows = await query<{ slug: string; title: string; group: string }>(
    `MATCH (e:Event)
     WHERE NOT (e)-[:INVOLVED]->()
       AND e.group <> 'Narrative'
       AND e.group <> 'EscapeRoute'
     RETURN e.slug AS slug, e.title AS title, e.group AS group`,
  )
  for (const r of rows) {
    add({ type: 'no-people', severity: 'warning', eventSlug: r.slug, eventTitle: r.title,
      message: `${r.group} event has no participants`, data: { group: r.group } })
  }
  console.log(`no-people           ${rows.length}`)
}

// ── 3. Events with no location or station ────────────────────────────────
{
  const rows = await query<{ slug: string; title: string; group: string }>(
    `MATCH (e:Event)
     WHERE NOT (e)-[:ORIGIN|DESTINATION|DEPARTED_FROM|ARRIVED_AT]->()
       AND e.group IN ['AirMission','SeaPatrol','NNIUMission','StationOperation','CommandoRaid','Sabotage']
     RETURN e.slug AS slug, e.title AS title, e.group AS group`,
  )
  for (const r of rows) {
    add({ type: 'no-location', severity: 'warning', eventSlug: r.slug, eventTitle: r.title,
      message: `${r.group} event has no location or station`, data: { group: r.group } })
  }
  console.log(`no-location         ${rows.length}`)
}

// ── 4. Mission-type events missing an Oppdrag section ────────────────────
{
  const rows = await query<{ slug: string; title: string; group: string }>(
    `MATCH (e:Event)
     WHERE e.group IN ['StationOperation','CommandoRaid','NNIUMission','Sabotage']
       AND NOT (e)-[:HAS_SECTION]->(:Section {type: 'oppdrag'})
     RETURN e.slug AS slug, e.title AS title, e.group AS group`,
  )
  for (const r of rows) {
    add({ type: 'missing-oppdrag', severity: 'info', eventSlug: r.slug, eventTitle: r.title,
      message: `${r.group} event has no extracted Oppdrag section`, data: { group: r.group } })
  }
  console.log(`missing-oppdrag     ${rows.length}`)
}

// ── 5. Log entry dates outside war years (1939–1946) ─────────────────────
{
  const rows = await query<{ slug: string; title: string; date: string; text: string }>(
    `MATCH (e:Event)-[:HAS_LOG_ENTRY]->(l:LogEntry)
     WHERE l.date < '1939-01-01' OR l.date > '1946-12-31'
     RETURN e.slug AS slug, e.title AS title, l.date AS date, l.text AS text`,
  )
  for (const r of rows) {
    add({ type: 'date-out-of-range', severity: 'error', eventSlug: r.slug, eventTitle: r.title,
      message: `Log entry date ${r.date} is outside 1939–1946`,
      data: { date: r.date, text: r.text.slice(0, 80) } })
  }
  console.log(`date-out-of-range   ${rows.length}`)
}

// ── 6. Arrest records with no matching Person node ───────────────────────
{
  const rows = await query<{ slug: string; title: string; name: string; date: string }>(
    `MATCH (e:Event)-[:HAS_LOG_ENTRY]->(l:LogEntry {type: 'arrest'})
     WHERE NOT EXISTS {
       MATCH (p:Person)
       WHERE toLower(p.name) CONTAINS toLower(l.text)
          OR toLower(l.text) CONTAINS toLower(p.name)
     }
     RETURN e.slug AS slug, e.title AS title, l.text AS name, l.date AS date`,
  )
  for (const r of rows) {
    add({ type: 'arrest-unmatched', severity: 'info', eventSlug: r.slug, eventTitle: r.title,
      message: `Arrest record '${r.name}' on ${r.date} has no matching Person node`,
      data: { name: r.name, date: r.date } })
  }
  console.log(`arrest-unmatched    ${rows.length}`)
}

// ── 7. Extraction issues from sanity-analyze ─────────────────────────────
{
  let count = 0
  for (const meta of eventMeta) {
    for (const issue of meta.issues) {
      add({ type: 'extraction-issue', severity: 'info',
        eventSlug: meta.slug, eventTitle: meta.title,
        message: issue, data: { group: meta.group } })
      count++
    }
  }
  console.log(`extraction-issue    ${count}`)
}

// ── 8. Events with no content at all (no sections, no description) ────────
{
  const rows = await query<{ slug: string; title: string }>(
    `MATCH (e:Event)
     WHERE NOT (e)-[:HAS_SECTION]->()
       AND NOT (e)-[:HAS_LOG_ENTRY]->()
     RETURN e.slug AS slug, e.title AS title`,
  )
  for (const r of rows) {
    add({ type: 'no-content', severity: 'warning', eventSlug: r.slug, eventTitle: r.title,
      message: 'Event has no sections and no log entries' })
  }
  console.log(`no-content          ${rows.length}`)
}

// ── Write output ──────────────────────────────────────────────────────────────

await driver.close()

const outPath = resolve(process.cwd(), 'data/audit-report.json')
writeFileSync(outPath, JSON.stringify(findings, null, 2) + '\n')

// ── Summary ───────────────────────────────────────────────────────────────────

const bySeverity = { error: 0, warning: 0, info: 0 }
const byType: Record<string, number> = {}
for (const f of findings) {
  bySeverity[f.severity]++
  byType[f.type] = (byType[f.type] ?? 0) + 1
}

console.log(`\n── Audit complete ────────────────────────────────────────────────`)
console.log(`  Total findings:  ${findings.length}`)
console.log(`  Errors:          ${bySeverity.error}`)
console.log(`  Warnings:        ${bySeverity.warning}`)
console.log(`  Info:            ${bySeverity.info}`)
console.log(`\nBy type:`)
for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type.padEnd(22)} ${String(count).padStart(5)}`)
}
console.log(`\n→ data/audit-report.json`)
