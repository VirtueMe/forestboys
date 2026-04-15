/**
 * Imports Planet operation data into Neo4j from:
 *   data/sanity-event-meta.json  — structured extraction from sanity-analyze.ts
 *   data/planet-kml.json         — coordinates from planet-kml-parse.ts
 *   data/sanity-person.json      — person slugs for MEMBER_OF relationships
 *
 * Prerequisite scripts (run in order):
 *   1. npx tsx scripts/sanity-analyze.ts
 *   2. npx tsx scripts/planet-kml-parse.ts
 *   3. npx tsx scripts/neo4j-import-full.ts    ← creates Event + Person nodes
 *   4. npx tsx scripts/neo4j-import-planet.ts  ← this script
 *
 * Safe to re-run — uses MERGE throughout.
 *
 * What this script creates:
 *   (:Operation:Planet)            — one per Planet event
 *   (:Location)                    — HQ, Depot, Amøbe, Bi-celle with KML coords
 *   (:TrainingBatch)               — Åhlby cohorts grouped by training date
 *   (:Event)-[:DESCRIBES]->(:Operation:Planet)
 *   (:Operation)-[:HQ_AT|HAS_UNIT]->(:Location)
 *   (:Person)-[:MEMBER_OF {codename, role}]->(:Operation)
 *   (:Person)-[:PARTICIPATED_IN {arrived_sweden}]->(:TrainingBatch)
 *   Operation.boundary             — computed convex hull GeoJSON polygon
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import neo4j from 'neo4j-driver'
import * as dotenv from 'dotenv'

dotenv.config({ path: resolve(process.cwd(), '.env') })

import type { PlanetExtracted } from './sanity-analyze.ts'
import type { PlanetKml, KmlPoint } from './planet-kml-parse.ts'

// ── Load data ─────────────────────────────────────────────────────────────────

const dataDir = resolve(process.cwd(), 'data')
function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8')) as T
}

type EventMetaRow = {
  _id:    string
  slug:   string
  title:  string
  group:  string
  planet?: PlanetExtracted
}

const eventMeta    = load<EventMetaRow[]>('sanity-event-meta.json')
const kml          = load<PlanetKml>('planet-kml.json')
const rawPeople    = load<Array<{ _id: string; name?: string; slug?: { current?: string } }>>('sanity-person.json')
const rawEvents    = load<Array<{ _id: string; slug?: { current?: string }; people?: Array<{ _ref: string }> }>>('sanity-event.json')
const rawLocations = load<Array<{ _id: string; title?: string; slug?: { current?: string }; coordinates?: { lat?: number; lng?: number } }>>('sanity-location.json')

const planetEvents = eventMeta.filter(e => e.group === 'PlanetOperation' && e.planet)

// ── Manual overrides ──────────────────────────────────────────────────────────

/**
 * data/planet-person-overrides.json — hand-maintained lookup for names the
 * automatic resolver cannot match (people not yet in Sanity, abbreviations,
 * OCR artefacts, etc.).
 *
 * Format:
 * [
 *   { "rawName": "Per Arne Pedersen", "slug": "per-arne-pedersen", "note": "added 2026-04" },
 *   { "rawName": "Per Arne Pedersen", "slug": null, "note": "not in DB yet" }
 * ]
 *
 * slug: null  → suppress the "unresolved" warning; person is intentionally absent.
 * slug: ""    → not yet filled in; will still appear in the report.
 */
interface PersonOverride {
  rawName: string
  slug:    string | null   // null = "known absent", "" = "not yet filled in"
  note?:   string
}

const overridesPath = resolve(dataDir, 'planet-person-overrides.json')
const overrides: PersonOverride[] = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, 'utf-8')) as PersonOverride[]
  : []
const overrideMap = new Map(overrides.map(o => [o.rawName.trim(), o]))

// ── Person lookup ─────────────────────────────────────────────────────────────

/**
 * Normalize a person name for matching.
 * - Lowercase, strip punctuation
 * - Replace Norwegian letters with Latin equivalents (mirrors Sanity slug rules):
 *   ø→o, æ→ae, å→a  — source PDFs sometimes lose diacritics so both forms must match
 */
function normName(s: string) {
  return s.trim().toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a')
    .replace(/[.,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Global index 0: Sanity _id → {name, slug} — used to resolve deltakere refs
const personById = new Map<string, { name: string; slug: string }>()
for (const p of rawPeople) {
  if (p._id && p.name && p.slug?.current) personById.set(p._id, { name: p.name, slug: p.slug.current })
}

/**
 * Per-event deltakere lookup: eventSlug → Map<normName → personSlug>
 *
 * The Sanity `people` field contains already-resolved person references —
 * these are the authoritative slugs for everyone linked to the event.
 * We use this as a first-pass lookup before the global fuzzy index.
 */
const deltakereByEvent = new Map<string, Map<string, string>>()
for (const ev of rawEvents) {
  const slug = ev.slug?.current
  if (!slug || !ev.people?.length) continue
  const map = new Map<string, string>()
  for (const ref of ev.people) {
    const p = personById.get(ref._ref)
    if (p) map.set(normName(p.name), p.slug)
  }
  deltakereByEvent.set(slug, map)
}

// Global index 1: exact normName → slug (indexes both full name and suffix-stripped form)
const personByNorm  = new Map<string, string>()
// Index 2: last significant word → slug[] (for unique-last-name lookup)
const personByLast  = new Map<string, string[]>()
// Index 3: raw slug → slug (for slug-construction lookup)
const personBySlug  = new Map<string, string>()

for (const p of rawPeople) {
  if (!p.name || !p.slug?.current) continue
  const sl = p.slug.current

  personBySlug.set(sl, sl)

  const norm = normName(p.name)
  personByNorm.set(norm, sl)

  // Also index name with trailing capitalised role words stripped, e.g. "Kamel"
  // Strip any trailing token that is Capitalised (not all-lowercase)
  const words = norm.split(' ').filter(Boolean)
  let stripped = norm
  while (words.length > 1 && /^[a-z]{1,2}$/.test(words.at(-1)!) === false) {
    // remove last word if it looks like a role suffix (uncommon word, capitalised in original)
    const orig = p.name.split(/\s+/)
    const lastOrig = orig.at(-1) ?? ''
    if (/^[A-ZÆØÅ]/.test(lastOrig) && orig.length > 2) {
      words.pop()
      orig.pop()
      stripped = words.join(' ')
    } else {
      break
    }
  }
  if (stripped !== norm) personByNorm.set(stripped, sl)

  // Last-word index on the stripped form
  const lastWord = stripped.split(' ').filter(w => w.length >= 2).at(-1)
  if (lastWord) {
    const arr = personByLast.get(lastWord) ?? []
    arr.push(sl)
    personByLast.set(lastWord, arr)
  }
}

/** Construct a Sanity-style slug from a name (same normalization Sanity applies) */
function nameToSlug(name: string): string {
  return normName(name).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

type ResolutionMethod = 'exact' | 'slug' | 'last-word' | 'initial' | 'override' | 'auto-generated' | 'unresolved'

/** Slug prefix that marks auto-generated Person stubs */
const AUTO_PREFIX = 'auto-'
function autoSlug(rawName: string) { return AUTO_PREFIX + nameToSlug(rawName) }

interface Resolution {
  slug:   string | null
  method: ResolutionMethod
}

function resolvePersonSlug(rawName: string, eventSlug: string): Resolution {
  // 0. Manual override takes priority
  const override = overrideMap.get(rawName.trim())
  if (override) {
    return { slug: override.slug || null, method: 'override' }
  }

  const n = normName(rawName)

  // 1a. Deltakere list for this event — authoritative Sanity-resolved refs
  const deltakere = deltakereByEvent.get(eventSlug)
  if (deltakere) {
    const fromDeltakere = deltakere.get(n)
    if (fromDeltakere) return { slug: fromDeltakere, method: 'exact' }
    // Also try suffix-stripped form (e.g. "Per Røtvold Kamel" → "Per Røtvold")
    const words = n.split(' ').filter(Boolean)
    for (let len = words.length - 1; len >= 2; len--) {
      const prefix = words.slice(0, len).join(' ')
      const prefixMatch = deltakere.get(prefix)
      if (prefixMatch) return { slug: prefixMatch, method: 'exact' }
    }
  }

  // 1b. Exact normalized match against global index
  const exact = personByNorm.get(n)
  if (exact) return { slug: exact, method: 'exact' }

  // 2. Slug construction: mirrors how Sanity generates slugs (handles ø→o etc.)
  const slug = nameToSlug(rawName)
  if (personBySlug.has(slug)) return { slug, method: 'slug' }

  const words = n.split(' ').filter(w => w.length >= 2)
  if (!words.length) return { slug: null, method: 'unresolved' }
  const last = words.at(-1)!

  // 3. Unique last-word match
  const byLast = personByLast.get(last)
  if (byLast?.length === 1) return { slug: byLast[0], method: 'last-word' }

  // 4. Abbreviated first name: "Ch." → try first-letter + last-word
  //    Only when first word is ≤3 chars (abbreviation) and last word is unique
  if (words[0].length <= 3 && words.length >= 2) {
    const initial = words[0].replace(/\.$/, '')[0]
    const candidates: string[] = []
    for (const [dbNorm, dbSlug] of personByNorm) {
      const dbWords = dbNorm.split(' ').filter(w => w.length >= 2)
      if (dbWords.at(-1) === last && dbWords[0]?.[0] === initial) {
        candidates.push(dbSlug)
      }
    }
    const unique = [...new Set(candidates)]
    if (unique.length === 1) return { slug: unique[0], method: 'initial' }
  }

  // 5. Nothing matched — create a stub node so the graph stays complete
  return { slug: autoSlug(rawName), method: 'auto-generated' }
}

// ── KML lookup ────────────────────────────────────────────────────────────────

/** Normalize a location name for KML matching (lowercase, collapse whitespace) */
function normLoc(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

const kmlByNorm = new Map<string, KmlPoint>()
for (const pt of kml.points) kmlByNorm.set(normLoc(pt.name), pt)

/** Try several normalizations to find a KML point for a source location name */
function findKmlPoint(kmlName: string): KmlPoint | null {
  // Direct match
  const direct = kmlByNorm.get(normLoc(kmlName))
  if (direct) return direct

  // Bi-celle / bi-cell variant — try both spellings
  const biNorm = normLoc(kmlName)
  if (biNorm.includes('bi-celle ') || biNorm.includes('bi-cell ')) {
    const alt = biNorm.includes('bi-celle ')
      ? biNorm.replace('bi-celle ', 'bi-cell ')
      : biNorm.replace('bi-cell ', 'bi-celle ')
    const altPt = kmlByNorm.get(alt)
    if (altPt) return altPt
  }

  return null
}

// ── Sanity location proximity matching ───────────────────────────────────────

/**
 * If a KML point is within PROXIMITY_M metres of an existing Sanity Location
 * we decorate that node instead of creating a duplicate.
 */
const PROXIMITY_M = 300

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const sanityLocIndex = rawLocations
  .filter(l => l.coordinates?.lat && l.coordinates?.lng && l.slug?.current)
  .map(l => ({ slug: l.slug!.current!, title: l.title ?? '', lat: l.coordinates!.lat!, lng: l.coordinates!.lng! }))

/** Returns the Sanity Location slug if one exists within PROXIMITY_M, else null. */
function findSanityLocation(lat: number, lng: number): string | null {
  let best: { slug: string; dist: number } | null = null
  for (const loc of sanityLocIndex) {
    const d = haversineM(lat, lng, loc.lat, loc.lng)
    if (d <= PROXIMITY_M && (!best || d < best.dist)) best = { slug: loc.slug, dist: d }
  }
  return best?.slug ?? null
}

/**
 * A LocRef describes how to MATCH a Location node in Cypher.
 * Sanity locations are keyed by slug; Planet-only locations by id.
 */
type LocRef = { kind: 'sanity'; slug: string } | { kind: 'planet'; id: string }

// ── Convex hull ───────────────────────────────────────────────────────────────

/**
 * Graham scan convex hull over [lng, lat] points.
 * Returns the hull in counter-clockwise order, closed (first = last).
 */
function convexHull(pts: Array<[number, number]>): Array<[number, number]> | null {
  if (pts.length < 3) return null

  // Find bottom-most (min lat), leftmost (min lng) as pivot
  let pivot = 0
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][1] < pts[pivot][1] || (pts[i][1] === pts[pivot][1] && pts[i][0] < pts[pivot][0])) {
      pivot = i
    }
  }
  const [px, py] = pts[pivot]

  const others = pts.filter((_, i) => i !== pivot)
  others.sort((a, b) => {
    const angA = Math.atan2(a[1] - py, a[0] - px)
    const angB = Math.atan2(b[1] - py, b[0] - px)
    if (Math.abs(angA - angB) > 1e-10) return angA - angB
    return Math.hypot(a[0]-px, a[1]-py) - Math.hypot(b[0]-px, b[1]-py)
  })

  const hull: Array<[number, number]> = [[px, py]]
  for (const pt of others) {
    while (hull.length >= 2) {
      const [ax, ay] = hull[hull.length - 2]
      const [bx, by] = hull[hull.length - 1]
      // Cross product: positive = left turn (keep), 0 or negative = remove b
      const cross = (bx-ax)*(pt[1]-ay) - (by-ay)*(pt[0]-ax)
      if (cross <= 0) hull.pop()
      else break
    }
    hull.push(pt)
  }

  // Close the polygon
  hull.push(hull[0])
  return hull
}

function toGeoJsonPolygon(hull: Array<[number, number]>): string {
  return JSON.stringify({ type: 'Polygon', coordinates: [hull] })
}

// ── Unique ID helpers ─────────────────────────────────────────────────────────

function opId(opName: string, region: string) {
  return `planet-op-${opName.toLowerCase()}-${region.toLowerCase()}`
}

function locId(kmlName: string) {
  return `planet-loc-${kmlName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`
}

function batchId(camp: string, date: string) {
  return `training-batch-${camp.toLowerCase().replace(/\s+/g, '-')}-${date}`
}

// ── Main ──────────────────────────────────────────────────────────────────────

const driver  = neo4j.driver(
  process.env['NEO4J_URI']!,
  neo4j.auth.basic(process.env['NEO4J_USERNAME']!, process.env['NEO4J_PASSWORD']!),
)
// Second driver instance for the post-import review write (driver is closed before the report runs)
const driver2 = neo4j.driver(
  process.env['NEO4J_URI']!,
  neo4j.auth.basic(process.env['NEO4J_USERNAME']!, process.env['NEO4J_PASSWORD']!),
)

// ── Resolution log (populated during import, reported at end) ─────────────────

interface ResolutionLog {
  rawName:       string
  resolvedSlug:  string | null
  method:        ResolutionMethod
  operation:     string           // e.g. "Venus (SE)"
  eventSlug:     string
  codename:      string | null
  arrivedSweden: string | null
  aahlyDate:     string | null
}

const resolutionLog: ResolutionLog[] = []

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const session = driver.session()

  try {
    // Ensure constraints
    await session.run(`CREATE CONSTRAINT planet_op_id IF NOT EXISTS FOR (o:Operation) REQUIRE o.id IS UNIQUE`)
    await session.run(`CREATE CONSTRAINT planet_loc_id IF NOT EXISTS FOR (l:Location)  REQUIRE l.id IS UNIQUE`)
    await session.run(`CREATE CONSTRAINT planet_batch_id IF NOT EXISTS FOR (b:TrainingBatch) REQUIRE b.id IS UNIQUE`)

    console.log(`Processing ${planetEvents.length} Planet operation(s)…\n`)

    for (const ev of planetEvents) {
      const p = ev.planet!
      const { operationName, region, roster, locations } = p
      const opNodeId  = opId(operationName, region)
      const opLabel   = `${operationName} (${region})`

      console.log(`  ${opLabel} — ${ev.slug}`)

      const tx = session.beginTransaction()
      try {

        // ── Operation:Planet node ────────────────────────────────────────────
        await tx.run(
          `MERGE (o:Operation {id: $id})
           SET o:Planet,
               o.name   = $name,
               o.region = $region,
               o.status = "Aktiv"`,
          { id: opNodeId, name: operationName, region },
        )

        // ── Link Event → Operation ───────────────────────────────────────────
        await tx.run(
          `MATCH (e:Event {slug: $slug}), (o:Operation {id: $opId})
           MERGE (e)-[:DESCRIBES]->(o)`,
          { slug: ev.slug, opId: opNodeId },
        )

        // ── Location nodes + Operation relationships ─────────────────────────
        const hullCoords: Array<[number, number]> = []

        for (const loc of locations) {
          const kmlPt = findKmlPoint(loc.kmlName)

          // If a Sanity Location already exists at these coordinates, decorate
          // it instead of creating a duplicate node.
          let locRef: LocRef
          if (kmlPt) {
            const sanitySlug = findSanityLocation(kmlPt.lat, kmlPt.lng)
            if (sanitySlug) {
              locRef = { kind: 'sanity', slug: sanitySlug }
              // Sanity node already exists — just tag it with Planet metadata
              await tx.run(
                `MATCH (l:Location {slug: $slug})
                 SET l.planetType   = $type,
                     l.planetStatus = $status`,
                { slug: sanitySlug, type: loc.type, status: loc.status },
              )
            } else {
              locRef = { kind: 'planet', id: locId(loc.kmlName) }
              await tx.run(
                `MERGE (l:Location {id: $id})
                 SET l.name   = $name,
                     l.type   = $type,
                     l.status = $status,
                     l.lat    = $lat,
                     l.lng    = $lng`,
                { id: locRef.id, name: loc.kmlName, type: loc.type, status: loc.status, lat: kmlPt.lat, lng: kmlPt.lng },
              )
            }
            hullCoords.push([kmlPt.lng, kmlPt.lat])
          } else {
            // No KML coords — always create a Planet-specific node
            locRef = { kind: 'planet', id: locId(loc.kmlName) }
            await tx.run(
              `MERGE (l:Location {id: $id})
               SET l.name   = $name,
                   l.type   = $type,
                   l.status = $status`,
              { id: locRef.id, name: loc.kmlName, type: loc.type, status: loc.status },
            )
          }

          // Link Operation → Location using whichever key identifies it
          const locKey   = locRef.kind === 'sanity' ? locRef.slug : locRef.id
          const locProp  = locRef.kind === 'sanity' ? 'slug' : 'id'

          if (loc.type === 'HQ') {
            await tx.run(
              `MATCH (o:Operation {id: $opId}), (l:Location {${locProp}: $locKey})
               MERGE (o)-[:HQ_AT]->(l)`,
              { opId: opNodeId, locKey },
            )
          } else {
            await tx.run(
              `MATCH (o:Operation {id: $opId}), (l:Location {${locProp}: $locKey})
               MERGE (o)-[:HAS_UNIT {unit_type: $unitType}]->(l)`,
              { opId: opNodeId, locKey, unitType: loc.type },
            )
          }
        }

        // ── Convex hull boundary ─────────────────────────────────────────────
        if (hullCoords.length >= 3) {
          const hull = convexHull(hullCoords)
          if (hull) {
            await tx.run(
              `MATCH (o:Operation {id: $id})
               SET o.boundary        = $boundary,
                   o.boundary_source = "computed"`,
              { id: opNodeId, boundary: toGeoJsonPolygon(hull) },
            )
          }
        }

        // ── Personnel: MEMBER_OF + TrainingBatch ─────────────────────────────
        for (const entry of roster) {
          const { slug: personSlug, method } = resolvePersonSlug(entry.rawName, ev.slug)

          resolutionLog.push({
            rawName:       entry.rawName,
            resolvedSlug:  personSlug,
            method,
            operation:     opLabel,
            eventSlug:     ev.slug,
            codename:      entry.codename ?? null,
            arrivedSweden: entry.arrivedSweden ?? null,
            aahlyDate:     entry.aahlyDate    ?? null,
          })

          if (!personSlug) continue   // null only from override with slug: null

          // If auto-generated: ensure the stub Person node exists
          if (method === 'auto-generated') {
            await tx.run(
              `MERGE (p:Person {slug: $slug})
               ON CREATE SET p.name          = $name,
                             p.autoGenerated = true,
                             p.source        = "planet-roster"`,
              { slug: personSlug, name: entry.rawName },
            )
          }

          // If this entry has a real override slug, retire the old auto stub
          if (method === 'override' && personSlug) {
            const stale = autoSlug(entry.rawName)
            await tx.run(
              `OPTIONAL MATCH (stub:Person {slug: $stale})
               WHERE stub.autoGenerated = true
               DETACH DELETE stub`,
              { stale },
            )
          }

          // MEMBER_OF with codename
          await tx.run(
            `MATCH (p:Person {slug: $slug}), (o:Operation {id: $opId})
             MERGE (p)-[m:MEMBER_OF]->(o)
             SET m.codename = $codename,
                 m.role     = "Kamel"`,
            {
              slug:     personSlug,
              opId:     opNodeId,
              codename: entry.codename ?? null,
            },
          )

          // TrainingBatch
          if (entry.aahlyDate) {
            const bId = batchId('Åhlby Gård', entry.aahlyDate)
            await tx.run(
              `MERGE (b:TrainingBatch {id: $id})
               SET b.camp = "Åhlby Gård",
                   b.date = $date`,
              { id: bId, date: entry.aahlyDate },
            )
            await tx.run(
              `MATCH (b:TrainingBatch {id: $bId}), (o:Operation {id: $opId})
               MERGE (b)-[:PREPARED_FOR]->(o)`,
              { bId, opId: opNodeId },
            )
            await tx.run(
              `MATCH (p:Person {slug: $slug}), (b:TrainingBatch {id: $bId})
               MERGE (p)-[r:PARTICIPATED_IN]->(b)
               SET r.arrived_sweden = $arrivedSweden`,
              { slug: personSlug, bId, arrivedSweden: entry.arrivedSweden ?? null },
            )
          }
        }

        await tx.commit()
        console.log(`    ✓ ${locations.length} locations, ${roster.length} roster entries`)

      } catch (err) {
        await tx.rollback()
        console.error(`    ✗ ${ev.slug}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

  } finally {
    await session.close()
    await driver.close()
  }

  // ── Resolution report → Neo4j ReviewItems ─────────────────────────────────

  const guessed       = resolutionLog.filter(r => r.method === 'last-word' || r.method === 'initial')
  const autoGenerated = resolutionLog.filter(r => r.method === 'auto-generated')
  const needsReview   = [...guessed, ...autoGenerated]

  if (needsReview.length) {
    console.log(`\n  Writing ${needsReview.length} review item(s) to Neo4j…`)
    const reviewSession = driver2.session()
    try {
      await reviewSession.run(
        `CREATE CONSTRAINT review_item_id IF NOT EXISTS FOR (r:ReviewItem) REQUIRE r.id IS UNIQUE`,
      )
      for (const r of needsReview) {
        const itemId = `review-${r.eventSlug}-${nameToSlug(r.rawName)}`
        await reviewSession.run(
          `MERGE (ri:ReviewItem {id: $id})
           ON CREATE SET ri.type         = $type,
                         ri.status       = "pending",
                         ri.rawName      = $rawName,
                         ri.resolvedSlug = $resolvedSlug,
                         ri.operation    = $operation,
                         ri.eventSlug    = $eventSlug,
                         ri.codename     = $codename,
                         ri.confidence   = $confidence,
                         ri.createdAt    = $createdAt
           ON MATCH SET  ri.rawName      = $rawName,
                         ri.resolvedSlug = $resolvedSlug,
                         ri.operation    = $operation,
                         ri.codename     = $codename,
                         ri.confidence   = $confidence`,
          {
            id:           itemId,
            type:         r.method === 'auto-generated' ? 'missing_person' : 'fuzzy_match',
            rawName:      r.rawName,
            resolvedSlug: r.resolvedSlug ?? '',
            operation:    r.operation,
            eventSlug:    r.eventSlug,
            codename:     r.codename ?? null,
            confidence:   r.method,
            createdAt:    new Date().toISOString().slice(0, 10),
          },
        )
      }
    } finally {
      await reviewSession.close()
    }
    console.log(`  ✓ Review items written (existing approved/rejected items preserved)`)
  }

  // ── Keep overrides file in sync (manual corrections still feed the import) ──

  const existing = new Set(overrides.map(o => o.rawName.trim()))
  const toAdd: PersonOverride[] = []

  for (const r of needsReview) {
    if (existing.has(r.rawName.trim())) continue
    existing.add(r.rawName.trim())
    toAdd.push({
      rawName: r.rawName,
      slug:    r.method === 'auto-generated' ? '' : (r.resolvedSlug ?? ''),
      note:    r.method === 'auto-generated'
        ? `auto-generated stub — fill with Sanity slug when available (${r.operation}${r.codename ? ` «${r.codename}»` : ''})`
        : `${r.method} match — verify (${r.operation})`,
    })
  }

  if (toAdd.length) {
    const updated = [...overrides, ...toAdd]
    writeFileSync(overridesPath, JSON.stringify(updated, null, 2) + '\n')
    console.log(`  → Added ${toAdd.length} new entr${toAdd.length === 1 ? 'y' : 'ies'} to data/planet-person-overrides.json`)
  }

  const totalResolved  = resolutionLog.filter(r => r.resolvedSlug).length
  const totalProcessed = resolutionLog.length
  console.log(`\n  ${totalResolved}/${totalProcessed} roster entries resolved (${autoGenerated.length} auto-stubs, ${guessed.length} fuzzy).`)
  await driver2.close()
  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
