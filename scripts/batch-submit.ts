/**
 * Batch Extraction: Sanity → Neo4j Cypher via Anthropic Batch API
 *
 * Reads cached JSON exports in data/sanity-{type}.json, builds one batch
 * request per document, and submits to the Anthropic Batch API.
 *
 * Model strategy (overridable with --model <id>):
 *   location / station / transport  → claude-haiku-4-5-20251001  ($1/$5 /MTok)
 *   person / event                  → claude-sonnet-4-6           ($3/$15 /MTok)
 *   person and event require inference-heavy extraction (Norwegian biography prose,
 *   role mining from narrative blocks) where Haiku quality falls short.
 *
 * Prompt caching strategy:
 *   system prompt  = all stable instructions (~5 000 tokens)
 *                    marked cache_control: ephemeral on every request
 *   user message   = document type + document JSON (varies per doc)
 *
 *   Cache hits are per-model — mixing Haiku and Sonnet in one batch means
 *   two cache writes. Still saves money, but cache hit rate is lower than a
 *   single-model run. The Batch API may also reject mixed-model submissions
 *   (spec unclear). Recommended split for full pipeline:
 *
 *     # Haiku — location, station, transport (~2 400 docs)
 *     npx tsx scripts/batch-submit.ts --exclude person,event
 *
 *     # Sonnet — person, event (~5 900 docs)
 *     npx tsx scripts/batch-submit.ts --exclude location,station,transport
 *
 *   Each single-model batch gets one cache write and ~90% cache reads.
 *
 * Run AFTER sanity-export.ts:
 *   npx tsx scripts/batch-submit.ts [--test]
 *
 * Then poll for results with:
 *   npx tsx scripts/batch-results.ts
 */

import Anthropic from '@anthropic-ai/sdk'
import * as dotenv from 'dotenv'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env') })

const DATA_DIR      = resolve(process.cwd(), 'data')
const PROGRESS_FILE = resolve(DATA_DIR, 'batch-progress.json')

type Progress = Partial<Record<DocType, number>>

function loadProgress(): Progress {
  try { return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')) } catch { return {} }
}

function saveProgress(progress: Progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2) + '\n')
}

// organization and district are generated directly by generate-simple-cypher.ts
// (no block content — pure structured field mapping, no Claude needed)
const DOMAIN_TYPES = ['location', 'station', 'person', 'transport', 'event'] as const
type DocType = typeof DOMAIN_TYPES[number]

// Per-type model selection.
// Haiku 4.5  ($1/$5 /MTok)  — structured fields + simple prose extraction
// Sonnet 4.6 ($3/$15 /MTok) — complex Norwegian biography / role-mining from events
const TYPE_MODELS: Record<DocType, string> = {
  location:  'claude-haiku-4-5-20251001',
  station:   'claude-haiku-4-5-20251001',
  transport: 'claude-haiku-4-5-20251001',
  person:    'claude-sonnet-4-6',
  event:     'claude-sonnet-4-6',
}

// ─── Shared system prompt (cached) ────────────────────────────────────────
//
// All 7 document types share this prompt. It is placed in the system role
// with cache_control so it is compiled once and reused for every request
// in the batch. Minimum cacheable size for claude-opus-4-6 is 4 096 tokens;
// this prompt is ~5 000 tokens, safely above the threshold.

const SYSTEM_PROMPT = `\
You are extracting structured graph data from Norwegian WWII resistance archive
documents (Milorg / NMB) into Neo4j Cypher statements.

You will receive one document at a time. The user message contains the document
type and the raw JSON. Apply the extraction rules for that type (below) and
output ONLY valid Cypher MERGE statements — no prose, no markdown fences.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UNIVERSAL RULES (apply to ALL document types)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Output ONLY valid Cypher MERGE statements. No prose, no explanation, no
   markdown fences.
2. Use MERGE not CREATE — all queries must be idempotent.
3. Use sanityId as the primary identifier on all nodes.
4. Resolve Sanity _ref values: the _ref string IS the sanityId of the target
   node — MERGE the target node by sanityId only, do not invent other properties.
5. Role extraction from blocks: event.people has no role field — extract roles
   from description block text and attach as properties on PARTICIPATED_IN edges.
   If no role found, emit the edge without a role property.
6. Descriptive text placement:
     About the node's nature      → SET as .description or .biography on the node
     About a relationship         → property on that edge
     Something that happened      → (:Event) node (only if not already the doc)
     Ambiguous                    → attach to (:Source) as .rawText + // REVIEW: <reason>
7. Flag uncertain extractions with // UNCERTAIN: <reason>
8. Every extracted node gets [:EXTRACTED_FROM]->(src)
9. Dates use ISO 8601: YYYY-MM-DD. Use null if unknown.
10. Ignore: slug, gallery, movie fields — media only, no graph value.

PROVENANCE — always include at the top of your output:
  MERGE (src:Source {sanityId: "<documentId>", blockKey: "root"})
  SET src.extractedAt = datetime()
(Replace <documentId> with the actual _id value from the document JSON.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NODE TAXONOMY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Node labels:
  (:Person)         source _type: person        primary key: sanityId
  (:Transport)      source _type: transport      primary key: sanityId
  (:Event)          source _type: event          primary key: sanityId
  (:Location)       source _type: location       primary key: sanityId
  (:Organization)   source _type: organization   primary key: sanityId
  (:Unit)           source _type: district       primary key: sanityId  ← label is Unit, NOT District
  (:Station)        source _type: station        primary key: sanityId
  (:Source)         provenance node              primary key: sanityId + blockKey
  (:ExtractionRun)  run metadata                 primary key: runId

Edge types:
  PARTICIPATED_IN   Person → Event              role? (mined from description)
  CREW_OF           Person → Transport          role  (mined from description)
  PART_OF           Event → Unit
  ORGANISED_BY      Event → Organization
  DEPARTED_FROM_LOCATION   Event → Location
  ARRIVED_AT_LOCATION      Event → Location
  DEPARTED_FROM_STATION    Event → Station
  ARRIVED_AT_STATION       Event → Station
  USED              Event → Transport
  ASSOCIATED_WITH   Location → Person
  STATIONED_AT      Person → Station
  MEMBER_OF         Person → Unit               from?, to?
  EXTRACTED_FROM    any → Source                confidence?
  RESULTED_IN       Event → Event               (for sub-events)
  CONTACT_WITH      Person → Person             context?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTRACTION RULES BY DOCUMENT TYPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

── organization ──────────────────────────────────────────────────────────────
Structured fields only (no block content):
  name   → Organization.name  (required)
  color  → Organization.color (hex string, UI colour coding)

── district  (label: Unit, NOT District) ─────────────────────────────────────
Structured fields only:
  name   → Unit.name  (required)

── location ──────────────────────────────────────────────────────────────────
Structured fields:
  title              → Location.title  (required)
  coordinates.lat    → Location.lat
  coordinates.lng    → Location.lng
  people[*]._ref     → (p:Person {sanityId: _ref})-[:ASSOCIATED_WITH]->(l)

Block fields (description[]):
  Description/history          → SET l.description
  Usage context (safe house,
    depot, landing site, etc.) → SET l.locationType
  Events that occurred here    → // REVIEW (event docs are authoritative)

── station ───────────────────────────────────────────────────────────────────
Structured fields:
  title              → Station.title  (required)
  type               → Station.type
  coordinates.lat    → Station.lat
  coordinates.lng    → Station.lng
  people[*]._ref     → (p:Person {sanityId: _ref})-[:STATIONED_AT]->(s)
                        NOTE: invert — person was stationed AT this station

Block fields (description[]):
  Description/history          → SET s.description
  Operational periods          → SET s.activeFrom, s.activeTo (if clearly stated)
  Events at this station       → // REVIEW (event docs are authoritative)

── person ────────────────────────────────────────────────────────────────────
Structured fields:
  name         → Person.name        (required)
  secretName   → Person.secretName
  home         → Person.home
  birthYear    → Person.birthYear
  links        → Person.links as JSON string

Block fields (description[]):
  Biography text               → SET p.biography
  Unit/cell memberships        → [:MEMBER_OF {from?, to?}]->(u:Unit {sanityId})
  Events                       → [:PARTICIPATED_IN {role?}]->(e:Event {sanityId})
  Person contacts              → [:CONTACT_WITH {context?}]->(p2:Person)
  Roles                        → attach as property on the relevant edge

── transport ─────────────────────────────────────────────────────────────────
Structured fields:
  name    → Transport.name    (required)
  type    → Transport.type    (boat / plane / car / etc.)
  unit    → Transport.unit    (military unit string)
  regser  → Transport.regser  (registration or serial number)
  reserve → Transport.reserve

Block fields (description[]):
  General description          → SET t.description
  Crew with roles              → (p:Person)-[:CREW_OF {role}]->(t)
                                 one edge per role if same person held multiple
  Events/crossings mentioned   → // REVIEW (event docs handle USED edges)
  Locations mentioned          → // REVIEW (event docs handle location edges)

── event  ★ most important type — links all other entities ───────────────────
Structured fields (all _ref values are sanityIds):
  title              → Event.title   (required)
  date               → Event.date    (ISO 8601)
  organization._ref  → [:ORGANISED_BY]->(org:Organization {sanityId})
  district._ref      → [:PART_OF]->(u:Unit {sanityId})
  locationFrom._ref  → [:DEPARTED_FROM_LOCATION]->(l:Location {sanityId})
  locationTo._ref    → [:ARRIVED_AT_LOCATION]->(l:Location {sanityId})
  stationFrom._ref   → [:DEPARTED_FROM_STATION]->(s:Station {sanityId})
  stationTo._ref     → [:ARRIVED_AT_STATION]->(s:Station {sanityId})
  people[*]._ref     → (p:Person {sanityId})-[:PARTICIPATED_IN]->(e)
                        !! roles NOT in schema — mine from description blocks
  transport[*]._ref  → [:USED]->(t:Transport {sanityId})

Block fields (description[]):
  Event narrative              → SET e.description
  Person roles                 → add role property to [:PARTICIPATED_IN] edge;
                                 match person by name/context to their _ref entry
  Additional people not in
    people[]                   → emit [:PARTICIPATED_IN {role?}]
  Additional transport not in
    transport[]                → emit [:USED]
  Sub-events (arrests, weather
    delays, damage)            → (:Event) child linked with [:RESULTED_IN]

CRITICAL for events:
  - ALWAYS attempt to extract roles for every person in people[]
  - If no role found: emit [:PARTICIPATED_IN] without role property
  - Flag: // UNCERTAIN: role inferred from context

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUALITY TAGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // UNCERTAIN: <reason>   extraction inferred, not explicit — Jan/Rolf to verify
  // REVIEW: <reason>      could not classify text — Jan/Rolf to assign manually
  (no comment)             high-confidence extraction — auto-accept
`

// ─── Helpers ──────────────────────────────────────────────────────────────

// Strip fields that add tokens but carry no graph value
function sanitiseDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...doc }
  delete stripped['gallery']
  delete stripped['movie']
  delete stripped['slug']
  return stripped
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set in .env')
    process.exit(1)
  }

  // ── CLI args ──────────────────────────────────────────────────────────────
  // --test            1 doc × first 3 types (quick smoke test)
  // --type <type>     only process this document type
  // --index <n>       override start offset (default: per-type progress from batch-progress.json)
  // --length <n>      how many documents to include (default: all remaining)
  // --model <id>      override model for all types in this run
  // --reset           ignore progress and start from 0 for all active types
  // --no-progress     do not update batch-progress.json after submit (for comparison runs)

  const testMode      = process.argv.includes('--test')
  const dryRun        = process.argv.includes('--dryrun')
  const resetMode     = process.argv.includes('--reset')
  const noProgress    = process.argv.includes('--no-progress')
  const modelIdx   = process.argv.indexOf('--model')
  const modelOverride = modelIdx >= 0 ? process.argv[modelIdx + 1] : null
  const modelFor   = (type: DocType) => modelOverride ?? TYPE_MODELS[type]

  const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined }

  const typeArg    = arg('--type') as DocType | undefined
  const indexArg   = arg('--index')
  const lengthArg  = arg('--length')
  const excludeArg = arg('--exclude')
  const excludeSet  = new Set((excludeArg ?? '').split(',').map(s => s.trim()).filter(Boolean))

  const filterType  = typeArg && DOMAIN_TYPES.includes(typeArg) ? typeArg : null
  const batchLength = lengthArg ? parseInt(lengthArg, 10) : null

  const progress = resetMode ? {} : loadProgress()
  const indexOverride = indexArg ? parseInt(indexArg, 10) : null

  const startIndexFor = (type: DocType) => indexOverride ?? progress[type] ?? 0

  // test mode: first 3 types, 1 doc each
  const activeTypes = testMode
    ? (DOMAIN_TYPES.slice(0, 3) as unknown as DocType[])
    : filterType
      ? [filterType]
      : DOMAIN_TYPES.filter(t => !excludeSet.has(t))

  console.log(`API key: ${apiKey.slice(0, 7)}…${apiKey.slice(-10)}`)

  if (!resetMode && Object.keys(progress).length > 0) {
    console.log('\nProgress (from batch-progress.json):')
    for (const [t, idx] of Object.entries(progress)) {
      console.log(`  ${t.padEnd(14)} next index: ${idx}`)
    }
    console.log()
  }

  const client = new Anthropic({ apiKey })

  const requests: object[] = []
  const summary: { type: string; model: string; count: number; from: number; to: number }[] = []

  for (const type of activeTypes) {
    const file = resolve(DATA_DIR, `sanity-${type}.json`)
    if (!existsSync(file)) {
      console.warn(`Skipping ${type} — ${file} not found. Run sanity-export.ts first.`)
      continue
    }

    const allDocs = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[]

    const from  = testMode ? 0 : startIndexFor(type)
    const end   = testMode ? 1 : batchLength ? from + batchLength : allDocs.length
    const docs  = allDocs.slice(from, end)

    let count = 0

    for (const doc of docs) {
      const docId = doc['_id'] as string
      if (!docId) continue

      const clean   = sanitiseDoc(doc)
      const docJson = JSON.stringify(clean, null, 2)

      const customId = `${type}__${docId.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 64)

      requests.push({
        custom_id: customId,
        params: {
          model: modelFor(type),
          max_tokens: testMode ? 2048 : (type === 'event' ? 32768 : 8192),
          // Stable system prompt — cached across all requests in this batch
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          // Variable user message — just type + raw JSON
          messages: [
            {
              role: 'user',
              content: `Document type: ${type}\n\n${docJson}`,
            },
          ],
        },
      })

      count++
    }

    summary.push({ type, model: modelFor(type), count, from: testMode ? 0 : startIndexFor(type), to: (testMode ? 0 : startIndexFor(type)) + count })
  }

  if (testMode) console.log('TEST MODE — 1 doc × 3 types (location, station, person)\n')

  console.log('Request summary:')
  let total = 0
  for (const { type, model, count, from, to } of summary) {
    const range = testMode ? '' : `  [${from}–${to - 1}]`
    console.log(`  ${type.padEnd(14)} ${String(count).padStart(5)} requests  ${model}${range}`)
    total += count
  }
  console.log(`  ${'TOTAL'.padEnd(14)} ${String(total).padStart(5)} requests`)
  if (modelOverride) console.log(`\n  (model override: ${modelOverride})`)
  console.log('\nBeta:    output-300k-2026-03-24 (max_tokens: 32 768 events / 8 192 others)')
  console.log('Caching: system prompt cached per model (~5 000 tokens per model)')
  console.log('Pricing: 50% batch discount + ~90% saving on cached tokens')

  const distinctModels = new Set(summary.map(s => s.model))
  if (distinctModels.size > 1) {
    console.warn(
      '\nWARN: mixed models in one batch — cache writes: ' + distinctModels.size +
      ', hit rate reduced.\n' +
      '      If the batch API rejects this, split into single-model runs:\n' +
      '        --exclude person,event        (Haiku)\n' +
      '        --exclude location,station,transport  (Sonnet)'
    )
  }
  console.log()

  if (dryRun) {
    console.log('DRY RUN — no batch submitted.')
    return
  }

  console.log('Submitting batch…')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batch = await (client.messages.batches as any).create(
    { requests },
    { headers: { 'anthropic-beta': 'output-300k-2026-03-24' } },
  )

  console.log(`\nBatch ID:  ${batch.id}`)
  console.log(`Status:    ${batch.processing_status}`)

  const RUNS_DIR = resolve(DATA_DIR, 'batch-runs')
  mkdirSync(RUNS_DIR, { recursive: true })

  const runMeta = {
    batchId:     batch.id,
    submittedAt: new Date().toISOString(),
    flags: {
      testMode,
      modelOverride: modelOverride ?? null,
      typeFilter:    filterType   ?? null,
      excludeTypes:  excludeSet.size > 0 ? [...excludeSet] : null,
      indexOverride,
      batchLength:   batchLength  ?? null,
    },
    types: summary,
    totalRequests: summary.reduce((n, s) => n + s.count, 0),
  }

  writeFileSync(resolve(RUNS_DIR, `${batch.id}.json`), JSON.stringify(runMeta, null, 2) + '\n')
  writeFileSync(resolve(DATA_DIR, 'batch-id.txt'), batch.id + '\n')

  // Update per-type progress so next run picks up where this one left off
  if (!testMode && !noProgress) {
    const updatedProgress = { ...progress }
    for (const { type, to } of summary) {
      updatedProgress[type as DocType] = to
    }
    saveProgress(updatedProgress)
    console.log('\nProgress saved to data/batch-progress.json')
  } else if (noProgress) {
    console.log('\nProgress NOT updated (--no-progress)')
  }

  console.log(`Run metadata saved to data/batch-runs/${batch.id}.json`)
  console.log('Batch ID saved to data/batch-id.txt')
  console.log('Run "npx tsx scripts/batch-results.ts" to poll for results.')
}

main().catch(err => { console.error(err); process.exit(1) })
