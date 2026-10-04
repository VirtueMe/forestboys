/**
 * One-shot: import the legacy Sanity person ↔ place links as STATIONED_AT
 * edges (docs/PERSON-STATIONED-AT.md, R14–R16).
 *
 *   data/sanity-location.json  location.people[]  → (Person)-[:STATIONED_AT]->(Location)
 *   data/sanity-station.json   station.people[]   → (Person)-[:STATIONED_AT]->(Station)
 *
 * Each edge: fresh `id`, no dates, a default `role`, `state: 'candidate'`
 * (unreviewed — Jan corrects roles and adds dates), and
 * `sourceRef: 'sanity-migration:<placeSanityId>:<personSanityId>'`.
 *
 * The default role is `training` (opplæring) for a Station whose category is
 * Skole, and `stationed` for everything else. A Station with no category yet
 * falls back to the category suggested by its free-text type
 * (src/utils/stationCategory.ts). Only a default: what a person did at a
 * place is per link (Ruben trained at Invergordon, a base), so Jan corrects
 * the odd one in the person editor; the person page puts `training` links
 * under «Har deltatt på» (docs/PERSON-STATIONED-AT.md, #70).
 *
 * - People and places resolve by `sanityId`. Any unresolved reference is
 *   reported and the write is refused (bulk-op rule: zero errors).
 * - Duplicate refs within one place collapse to one edge.
 * - Idempotent: a link whose sourceRef already exists is skipped.
 * - Both roles must exist in the stationed scope (scripts/seed-roles.ts).
 * - Places whose title suggests a role other than 'stationed' (prison,
 *   enemy post) are listed for review; they keep the default role as
 *   candidates.
 *
 * Local graph unless --production (scripts/lib/env.ts); production stays held
 * until the sanity-sync mapping record exists (project-sanity-sync).
 *
 * Usage: npx tsx scripts/migrate-stationed-at.ts [--write]
 */

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import { defaultRoleForStation } from '../../src/utils/stationCategory.ts'
loadEnv()

const write = process.argv.includes('--write')

interface SanityDoc {
  _id:     string
  title?:  string
  people?: { _ref: string }[]
}

type PlaceKind = 'location' | 'station'
const SOURCES: { kind: PlaceKind; label: string; file: string }[] = [
  { kind: 'location', label: 'Location', file: 'data/sanity-location.json' },
  { kind: 'station',  label: 'Station',  file: 'data/sanity-station.json' },
]

const DEFAULT_ROLES = ['stationed', 'training'] as const
type DefaultRole = typeof DEFAULT_ROLES[number]

/** `training` for a Skole station (its category, else the one its type suggests); `stationed` otherwise. */
function defaultRole(kind: PlaceKind, category: unknown, type: unknown): DefaultRole {
  return kind === 'station' ? defaultRoleForStation(category, typeof type === 'string' ? type : null) : 'stationed'
}

const REVIEW_RE = /fange|fengsel|prison|camp|luftwaffe|fluwa|wehrmacht|gestapo|tysk|german/i

const bareId = (id: string) => id.replace(/^drafts\./, '')

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
  )
  const session = driver.session()
  try {
    const people = await session.run(`MATCH (p:Person) RETURN p.sanityId AS id, p.slug AS slug`)
    const personById = new Map(people.records.map(r => [r.get('id') as string, r.get('slug') as string]))

    // The two default roles must be offered for the stationed scope.
    const roleRows = await session.run(`MATCH (r:Role) WHERE 'stationed' IN r.scopes RETURN r.key AS key`)
    const haveRoles = new Set(roleRows.records.map(r => r.get('key') as string))
    const missingRoles = DEFAULT_ROLES.filter(r => !haveRoles.has(r))
    if (missingRoles.length) {
      console.error(`Missing roles in the stationed scope: ${missingRoles.join(', ')} — run scripts/seed-roles.ts first.`)
      process.exitCode = 1
      return
    }

    const links: { kind: PlaceKind; placeSlug: string; personSlug: string; sourceRef: string; role: DefaultRole }[] = []
    const unresolved: string[] = []
    const review: string[] = []
    let duplicates = 0

    for (const src of SOURCES) {
      const docs = (JSON.parse(readFileSync(src.file, 'utf8')) as SanityDoc[]).filter(d => d.people?.length)
      const places = await session.run(
        `MATCH (pl:${src.label}) RETURN pl.sanityId AS id, pl.slug AS slug, pl.category AS category, pl.type AS type`)
      const placeById = new Map(places.records.map(r => [r.get('id') as string, {
        slug: r.get('slug') as string,
        role: defaultRole(src.kind, r.get('category'), r.get('type')),
      }]))

      let refs = 0
      for (const doc of docs) {
        const placeId   = bareId(doc._id)
        const place     = placeById.get(placeId)
        const placeSlug = place?.slug
        const n = doc.people!.length
        refs += n
        if (!placeSlug) {
          unresolved.push(`${src.kind} ${placeId} "${doc.title ?? ''}" (${n} links)`)
          continue
        }
        if (doc.title && REVIEW_RE.test(doc.title)) review.push(`${src.kind}:${placeSlug} "${doc.title}" (${n})`)

        const seen = new Set<string>()
        for (const ref of doc.people!) {
          const personId = bareId(ref._ref)
          if (seen.has(personId)) { duplicates++; continue }
          seen.add(personId)
          const personSlug = personById.get(personId)
          if (!personSlug) {
            unresolved.push(`person ${personId} at ${src.kind}:${placeSlug}`)
            continue
          }
          links.push({
            kind: src.kind, placeSlug, personSlug, role: place.role,
            sourceRef: `sanity-migration:${placeId}:${personId}`,
          })
        }
      }
      console.log(`${src.file}: ${docs.length} places, ${refs} refs`)
    }

    const existing = await session.run(
      `MATCH ()-[r:STATIONED_AT]->() WHERE r.sourceRef STARTS WITH 'sanity-migration:'
       RETURN collect(r.sourceRef) AS refs`)
    const have = new Set(existing.records[0]?.get('refs') as string[] ?? [])
    const todo = links.filter(l => !have.has(l.sourceRef))

    console.log(`\nResolved links: ${links.length} · duplicate refs collapsed: ${duplicates}`)
    console.log(`Already imported: ${links.length - todo.length} · to create: ${todo.length}`)

    const byRole = (role: DefaultRole) => todo.filter(l => l.role === role)
    const placesOf = (role: DefaultRole) => new Set(byRole(role).map(l => `${l.kind}:${l.placeSlug}`)).size
    console.log(`Default roles: training ${byRole('training').length} links at ${placesOf('training')} stations · ` +
      `stationed ${byRole('stationed').length} links at ${placesOf('stationed')} places`)

    if (review.length) {
      console.log(`\nPlaces to review (title suggests another role; they keep the default role):\n  ${review.join('\n  ')}`)
    }
    if (unresolved.length) {
      console.error(`\nUnresolved references (${unresolved.length}):\n  ${unresolved.join('\n  ')}`)
      console.error('\nRefusing to write until every reference resolves.')
      process.exitCode = 1
      return
    }

    if (!write) { console.log('\n(dry run — pass --write to import)'); return }

    for (const src of SOURCES) {
      const batch = todo.filter(l => l.kind === src.kind).map(l => ({ ...l, id: randomUUID() }))
      if (!batch.length) continue
      const res = await session.run(`
        UNWIND $batch AS l
        MATCH (p:Person {slug: l.personSlug})
        MATCH (pl:${src.label} {slug: l.placeSlug})
        CREATE (p)-[:STATIONED_AT {
          id: l.id, role: l.role, startDate: null, endDate: null,
          state: 'candidate', sourceRef: l.sourceRef
        }]->(pl)
        RETURN count(*) AS n
      `, { batch })
      const n = res.records[0]?.get('n').toNumber() as number
      console.log(`Created ${n} / ${batch.length} STATIONED_AT → ${src.label}`)
      if (n !== batch.length) process.exitCode = 1
    }
  } finally {
    await session.close()
    await driver.close()
  }
}
void main().catch(e => { console.error(e); process.exit(1) })
