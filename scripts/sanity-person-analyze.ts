/**
 * Analyze Sanity person descriptions to extract structured metadata:
 *  - bornDate  (from "F. d/m-yyyy" in description blocks)
 *  - logEntries (dated events: arrests, executions, operations)
 *  - diedDate  (ISO date of death-type log entry, if any)
 *  - diedType  (executed | killed-combat | killed-flight | killed-checkpoint)
 *
 * Reads:  data/sanity-person.json
 * Writes: data/sanity-person-meta.json
 *
 * Run after sanity-export.ts:
 *   npx tsx scripts/sanity-person-analyze.ts
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const dataDir   = resolve(process.cwd(), 'data')
const rawPeople = JSON.parse(readFileSync(resolve(dataDir, 'sanity-person.json'), 'utf-8')) as Record<string, unknown>[]

// ── Shared types ───────────────────────────────────────────────────────────────

export type LogType = 'report' | 'arrest' | 'executed' | 'killed-combat' | 'killed-flight' | 'killed-checkpoint'

export interface PersonLogEntry {
  date:   string    // ISO-8601 YYYY-MM-DD
  text:   string
  type:   LogType
}

export interface PersonMeta {
  _id:         string
  slug:        string
  bornDate?:   string   // ISO-8601 full date from "F. d/m-yyyy"
  diedDate?:   string   // ISO-8601 date from first death-type log entry
  diedType?:   Exclude<LogType, 'report' | 'arrest'>
  logEntries:  PersonLogEntry[]
}

// ── Block helpers ──────────────────────────────────────────────────────────────

interface SanityBlock {
  _type:     string
  children?: Array<{ text?: string }>
}

/** Join PDF line-break hyphens: "Johan-\nnessen" → "Johannessen" */
function dehyphenate(text: string): string {
  return text.replace(/-\n([a-zæøåA-ZÆØÅ])/g, '$1')
}

function blockText(b: SanityBlock): string {
  return dehyphenate((b.children ?? []).map(c => c.text ?? '').join('').trim())
}

function toText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return (blocks as SanityBlock[])
    .filter(b => b._type === 'block')
    .map(blockText)
    .join('\n')
}

// ── Date parsing ───────────────────────────────────────────────────────────────

/** Parse d/m-yy or d/m-yyyy → ISO "YYYY-MM-DD" */
function parseShortDate(d: string, m: string, y: string): string {
  const year  = y.length === 2 ? 1900 + parseInt(y) : parseInt(y)
  const month = parseInt(m).toString().padStart(2, '0')
  const day   = parseInt(d).toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ── Classification ─────────────────────────────────────────────────────────────

const ARREST_KEYWORDS            = /arrestert|arrestasjon/i
const EXECUTED_KEYWORDS          = /henrettet|skutt og drept|likvidert|hengt/i
const KILLED_COMBAT_KEYWORDS     = /falt i kamp|drept i kamp|omkom i kamp|falt under kamp|drept under kamp|falt i aksjon/i
const KILLED_FLIGHT_KEYWORDS     = /drept under flukt|omkom under flukt|drept under overgang|omkom under overgang|skutt under flukt/i
const KILLED_CHECKPOINT_KEYWORDS = /drept ved kontroll|skutt ved kontroll|drept under razzia|omkom under razzia|drept i razzia/i

function classifyText(text: string): LogType {
  if (ARREST_KEYWORDS.test(text))            return 'arrest'
  if (EXECUTED_KEYWORDS.test(text))          return 'executed'
  if (KILLED_COMBAT_KEYWORDS.test(text))     return 'killed-combat'
  if (KILLED_FLIGHT_KEYWORDS.test(text))     return 'killed-flight'
  if (KILLED_CHECKPOINT_KEYWORDS.test(text)) return 'killed-checkpoint'
  return 'report'
}

const DEATH_TYPES = new Set<LogType>(['executed', 'killed-combat', 'killed-flight', 'killed-checkpoint'])

// ── Patterns ───────────────────────────────────────────────────────────────────

// "F. 9/6-1904" or "f. 15/3-1912"
const BORN_RE    = /^[Ff]\.\s+(\d{1,2})\/(\d{1,2})[–-](\d{2,4})/
// Leading date: "5/3-41 Arrestert av tyskerne"
const LOG_DATE_RE = /^(\d{1,2})\/(\d{1,2})[–-](\d{2,4})\s+(.+)/

// ── Per-person extraction ──────────────────────────────────────────────────────

function analyzePerson(doc: Record<string, unknown>): PersonMeta {
  const id   = doc['_id'] as string
  const slug = (doc['slug'] as { current?: string })?.current ?? id
  const text = toText(doc['description'])

  let bornDate: string | undefined

  // From birthYear field if present (fallback for born)
  const birthYear = doc['birthYear'] as number | undefined

  const logEntries: PersonLogEntry[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    // Born date
    const born = BORN_RE.exec(line)
    if (born) {
      bornDate = parseShortDate(born[1], born[2], born[3])
      continue
    }

    // Log entry
    const log = LOG_DATE_RE.exec(line)
    if (log) {
      const entryText = log[4].trim()
      logEntries.push({
        date: parseShortDate(log[1], log[2], log[3]),
        text: entryText,
        type: classifyText(entryText),
      })
    }
  }

  // Derive bornDate from birthYear if not found in text
  if (!bornDate && birthYear) {
    bornDate = `${birthYear}-01-01`
  }

  // First death-type entry is the died date
  const deathEntry = logEntries.find(e => DEATH_TYPES.has(e.type))
  const diedDate   = deathEntry?.date
  const diedType   = deathEntry?.type as Exclude<LogType, 'report' | 'arrest'> | undefined

  return { _id: id, slug, bornDate, diedDate, diedType, logEntries }
}

// ── Main ───────────────────────────────────────────────────────────────────────

const results = rawPeople.map(analyzePerson)

const withData = results.filter(r => r.bornDate || r.diedDate || r.logEntries.length > 0)
console.log(`Analyzed ${rawPeople.length} people`)
console.log(`  with bornDate:  ${results.filter(r => r.bornDate).length}`)
console.log(`  with diedDate:  ${results.filter(r => r.diedDate).length}`)
console.log(`  with logEntries: ${results.filter(r => r.logEntries.length > 0).length}`)
console.log(`  total with data: ${withData.length}`)

writeFileSync(
  resolve(dataDir, 'sanity-person-meta.json'),
  JSON.stringify(results, null, 2),
  'utf-8',
)
console.log('\nWrote data/sanity-person-meta.json')
