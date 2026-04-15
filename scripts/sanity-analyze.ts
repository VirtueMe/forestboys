/**
 * Classifies each Sanity event document into a group and extracts structured
 * nodes from the description text. Writes data/sanity-event-meta.json.
 *
 * Run with: npx tsx scripts/sanity-analyze.ts
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

// ── People-section headers ─────────────────────────────────────────────────────

/** Section keys that contain person names and should be matched against the person DB */
const PEOPLE_SECTION_KEYS = new Set([
  'bemanning', 'crew', 'mannskap', 'styrke', 'agenter',
  'passasjerer', 'landsatte', 'personell', 'deltakere', 'squad',
])

// ── Types ─────────────────────────────────────────────────────────────────────

type Group =
  | 'AirMission'
  | 'RadioStation'
  | 'NNIUMission'
  | 'SeaPatrol'
  | 'MaritimeCraft'
  | 'StationOperation'
  | 'PlanetOperation'
  | 'CommandoRaid'
  | 'EscapeRoute'
  | 'Meeting'
  | 'Training'
  | 'Raid'
  | 'Sabotage'
  | 'Narrative'
  | 'Unknown'

export interface LogEntry {
  date:   string              // ISO-8601: YYYY-MM-DD
  text:   string
  type:   'report' | 'arrest' | 'executed' | 'killed-combat' | 'killed-flight' | 'killed-checkpoint' // report = ANCC log entry; others = person fate records
  offset: number              // char offset of this line in the concatenated block text — stable ID component
}

export interface MentionedPerson {
  slug:       string
  name:       string
  section:    string              // which section header the name was found in
  confidence: 'high' | 'medium'  // high = exact name match; medium = unique last-name match
}

export interface PlanetRosterEntry {
  codename:      string | null  // "Ole"
  rawName:       string         // "Rolf Odden" as written in source
  arrivedSweden: string | null  // ISO date: "1944-10-25"
  aahlyDate:     string | null  // ISO date: "1944-11-08" (Åhlby training batch date)
}

export interface PlanetLocationEntry {
  kmlName: string        // name to match against KML, e.g. "Venus amøbe D243"
  type:    string        // "HQ" | "Depot" | "Amøbe" | "Bi-celle"
  status:  string        // "Aktiv" | "Planlagt" | "Oppløst" | "Fullført"
  note:    string | null // narrative note, e.g. "Ble flytta til Grøtdalen..."
}

export interface PlanetExtracted {
  operationName: string               // "Venus"
  region:        string               // "SE" | "NO"
  roster:        PlanetRosterEntry[]
  locations:     PlanetLocationEntry[]
}

interface EventMeta {
  _id:              string
  slug:             string
  title:            string
  group:            Group
  extracted:        Record<string, unknown>
  sections:         Record<string, string>   // Norwegian section headers parsed from description
  content:          string                   // uncategorized description text, markdown-formatted
  logEntries:       LogEntry[]               // dated ANCC / station log entries
  mentionedPeople:  MentionedPerson[]        // people named in sections, matched against person DB
  startDate?:       string                   // ISO date — extracted from title or tidsrommet section
  endDate?:         string                   // ISO date — end of operation/active period
  issues:           string[]
  planet?:          PlanetExtracted          // only present when group === 'PlanetOperation'
}

// ── Portable text → plain text ────────────────────────────────────────────────

/** Join PDF line-break hyphens: "Johan-\nnessen" → "Johannessen" */
function dehyphenate(text: string): string {
  return text.replace(/-\n([a-zæøåA-ZÆØÅ])/g, '$1')
}

function toText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return dehyphenate(
    (blocks as Record<string, unknown>[])
      .filter(b => b['_type'] === 'block')
      .map(b => ((b['children'] as Record<string, unknown>[]) ?? []).map(c => (c['text'] as string) ?? '').join(''))
      .join('\n')
  )
}

// ── Section header detection ───────────────────────────────────────────────────

// Maps recognizable header keywords → canonical key in extracted{}
const SECTION_HEADER_MAP: Record<string, string> = {
  oppdrag:          'oppdrag',
  oppdraget:        'oppdrag',
  objective:        'oppdrag',
  deltakere:        'deltakere',
  personell:        'personell',
  personnel:        'personell',
  tidsrommet:       'tidsrommet',
  arbeidsomr:       'arbeidsomraade',   // prefix match for Arbeidsområdet/Arbeidsomrade
  resultat:         'resultat',
  // Source citations
  kilde:            'kilde',
  kilder:           'kilde',
  source:           'kilde',
  sources:          'kilde',
  // People-bearing sections
  bemanning:        'bemanning',
  crew:             'crew',
  mannskap:         'mannskap',
  styrke:           'styrke',
  agenter:          'agenter',
  agents:           'agenter',
  passasjerer:      'passasjerer',
  passengers:       'passasjerer',
  landsatte:        'landsatte',
  landsatt:         'landsatte',
  squad:            'squad',
}

interface SanityBlock {
  _type: string
  style?: string
  children?: Array<{ text?: string }>
}

function blockText(b: SanityBlock): string {
  return dehyphenate((b.children ?? []).map(c => c.text ?? '').join('').trim())
}

/** Convert a single portable-text block to a markdown string */
function blockToMarkdown(b: SanityBlock): string {
  const text = blockText(b)
  if (!text) return ''
  switch (b.style) {
    case 'h1': return `# ${text}`
    case 'h2': return `## ${text}`
    case 'h3': return `### ${text}`
    case 'h4': return `#### ${text}`
    case 'h5': return `##### ${text}`
    case 'blockquote': return text.split('\n').map(l => `> ${l}`).join('\n')
    default: return text
  }
}

// Leading date: "DD/MM-YY  TEXT..." — ANCC / station log reports
const LOG_DATE_RE = /^(\d{1,2})\/(\d{1,2})-(\d{2,4})\s+(.+)/
// Trailing date: "Person Name  DD/M-YY" — arrest / person records
const ARREST_DATE_RE = /^([A-ZÆØÅ][^\d\n]{2,}?)\s{1,}(\d{1,2})\/(\d{1,2})-(\d{2,4})\s*$/

/** Parse a date string components → ISO "YYYY-MM-DD" */
function parseLogDate(d: string, m: string, y: string): string {
  const year  = y.length === 2 ? 1900 + parseInt(y) : parseInt(y)
  const month = parseInt(m).toString().padStart(2, '0')
  const day   = parseInt(d).toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

const ARREST_KEYWORDS            = /arrestert|arrestasjon/i
const EXECUTED_KEYWORDS          = /henrettet|skutt og drept|likvidert|hengt/i
const KILLED_COMBAT_KEYWORDS     = /falt i kamp|drept i kamp|omkom i kamp|falt under kamp|drept under kamp|falt i aksjon/i
const KILLED_FLIGHT_KEYWORDS     = /drept under flukt|omkom under flukt|drept under overgang|omkom under overgang|skutt under flukt/i
const KILLED_CHECKPOINT_KEYWORDS = /drept ved kontroll|skutt ved kontroll|drept under razzia|omkom under razzia|drept i razzia/i

/** Classify a log entry text by the type of event it describes */
function classifyLogText(text: string): LogEntry['type'] {
  if (ARREST_KEYWORDS.test(text))            return 'arrest'
  if (EXECUTED_KEYWORDS.test(text))          return 'executed'
  if (KILLED_COMBAT_KEYWORDS.test(text))     return 'killed-combat'
  if (KILLED_FLIGHT_KEYWORDS.test(text))     return 'killed-flight'
  if (KILLED_CHECKPOINT_KEYWORDS.test(text)) return 'killed-checkpoint'
  return 'report'
}

/**
 * Extract dated entries from blocks:
 *  - "DD/MM-YY  TEXT..."   → type:'report'|'arrest'|'executed' (ANCC / station log)
 *  - "Person Name  DD/M-YY" → type:'arrest'|'executed' (trailing-date person record)
 * Continuation lines (no date) are appended to the previous report entry.
 */
function extractLogEntries(blocks: unknown): LogEntry[] {
  if (!Array.isArray(blocks)) return []
  const entries: LogEntry[] = []
  let current: LogEntry | null = null
  let charOffset = 0   // running char position through all block text

  for (const b of (blocks as SanityBlock[]).filter(b => b._type === 'block')) {
    const raw = blockText(b)
    const rawLines = raw.split('\n')

    for (const rawLine of rawLines) {
      const lineOffset = charOffset
      charOffset += rawLine.length + 1  // +1 for the newline

      const line = rawLine.trim()
      if (!line) continue

      const report = line.match(LOG_DATE_RE)
      if (report) {
        const text = report[4].trim()
        current = { date: parseLogDate(report[1], report[2], report[3]), text, type: classifyLogText(text), offset: lineOffset }
        entries.push(current)
        continue
      }

      const arrest = line.match(ARREST_DATE_RE)
      if (arrest) {
        current = null
        const text = arrest[1].trim()
        entries.push({ date: parseLogDate(arrest[2], arrest[3], arrest[4]), text, type: classifyLogText(text), offset: lineOffset })
        continue
      }

      // Continuation of previous report entry
      if (current?.type === 'report') {
        current.text += ' ' + line
      }
    }

    charOffset += 1  // block separator
  }

  // Deduplicate by (date + first 60 chars of text) — guards against Sanity
  // descriptions that contain the same log block in multiple places
  const seen = new Set<string>()
  return entries.filter(e => {
    const key = `${e.date}::${e.text.slice(0, 60)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Parse Norwegian section headers and collect uncategorized content from
 * portable text blocks.
 *
 * Returns:
 *   sections  — named section key → text (first occurrence wins)
 *   content   — all blocks NOT consumed by a named section, markdown-formatted
 *               with log-entry lines stripped (those live in logEntries)
 *
 * Works line-by-line so it handles both standalone header blocks and
 * inline headers ("Oppdraget: text\nmore text" in a single block).
 */
function extractSections(blocks: unknown): { sections: Record<string, string>; content: string } {
  if (!Array.isArray(blocks)) return { sections: {}, content: '' }
  const typedBlocks = (blocks as SanityBlock[]).filter(b => b._type === 'block')

  const sections: Record<string, string> = {}
  let currentKey: string | null = null
  const currentLines: string[] = []
  const contentParts: string[] = []   // uncategorized blocks as markdown

  function flush() {
    if (currentKey && currentLines.length) {
      const text = currentLines.join('\n').trim()
      if (text && !sections[currentKey]) sections[currentKey] = text
    }
    currentLines.length = 0
  }

  function handleLine(line: string, mdLine: string) {
    const stripped = line.replace(/^["«\u201c\u201d\s]+/, '')
    if (!stripped) return

    const lc = stripped.toLowerCase()
    let matchedKey: string | null = null
    let afterHeader = ''

    for (const [prefix, key] of Object.entries(SECTION_HEADER_MAP)) {
      if (lc.startsWith(prefix)) {
        const afterPrefix = stripped.slice(prefix.length)
        if (!afterPrefix || /^[:\s.]+/.test(afterPrefix)) {
          matchedKey = key
          afterHeader = afterPrefix.replace(/^[:\s.]+/, '').trim()
          break
        }
      }
    }

    if (matchedKey) {
      flush()
      currentKey = matchedKey
      if (afterHeader) currentLines.push(afterHeader)
    } else if (currentKey) {
      currentLines.push(line)
    } else {
      // Not under any named section — goes to uncategorized content
      // Skip log-entry lines (they become LogEntry nodes)
      if (!LOG_DATE_RE.test(stripped)) {
        contentParts.push(mdLine)
      }
    }
  }

  for (const b of typedBlocks) {
    const raw = blockText(b)
    if (!raw) continue
    const md  = blockToMarkdown(b)
    const rawLines = raw.split('\n')
    const mdLines  = md.split('\n')

    for (let i = 0; i < rawLines.length; i++) {
      handleLine(rawLines[i], mdLines[i] ?? rawLines[i])
    }
  }
  flush()

  return { sections, content: contentParts.join('\n\n').trim() }
}

// ── Classifier ────────────────────────────────────────────────────────────────

function classify(title: string): Group {
  const t = title.toUpperCase().trimStart()
  if (t.startsWith('AM ') || t.startsWith('AM\t'))                         return 'AirMission'
  if (t.startsWith('AX '))                                                  return 'AirMission'
  if (t.startsWith('CATALINA'))                                             return 'AirMission'
  if (/^BOAC[-/\s]/.test(t))                                               return 'AirMission'
  if (t.startsWith('AVRO'))                                                 return 'AirMission'
  if (/^SUB\d/.test(t))                                                     return 'AirMission'  // submarine ops
  if (t.startsWith('NNIU'))                                                 return 'NNIUMission'
  if (t.startsWith('COHQ'))                                                 return 'CommandoRaid'
  if (t.startsWith('MTB'))                                                  return 'SeaPatrol'
  if (t.startsWith('MSP'))                                                  return 'SeaPatrol'
  if (t.startsWith('AU '))                                                  return 'SeaPatrol'
  if (t.startsWith('CONVOY'))                                               return 'SeaPatrol'
  if (t.startsWith('HMSRN') || t.startsWith('HNOMS'))                     return 'SeaPatrol'
  if (t.startsWith('BALDER'))                                               return 'SeaPatrol'
  if (/^MK[-\s\t]/.test(t))                                                return 'MaritimeCraft'
  if (t.startsWith('MÅ ') || t.startsWith('SV ') || t.startsWith('RNA ') ||
      t.startsWith('OSELVAR') || t.startsWith('SPISSGATTER') ||
      t.startsWith('KNARR') || /^D\/?S\b/.test(t))                        return 'MaritimeCraft'
  if (/^(SOE|SIS) STATION/.test(t))                                        return 'RadioStation'
  if (/^(XU|USSR) (STATION|SENDER)/.test(t))                               return 'RadioStation'
  if (/^RUSSISK STASJON/.test(t))                                          return 'RadioStation'
  if (/^WT\b/.test(t))                                                      return 'RadioStation'
  if (t.startsWith('SOE') || t.startsWith('SIS') || t.startsWith('SO2'))  return 'StationOperation'
  if (t.startsWith('BAR-XU') || t.startsWith('EB-XU'))                    return 'StationOperation'
  if (t.startsWith('FROSTFILET') || t.startsWith('KLADD'))                 return 'StationOperation'
  if (t.startsWith('SVERIGE') || t.startsWith('KURS') && t.includes('SVERIGE')) return 'EscapeRoute'
  if (t.startsWith('ANCC') || t.startsWith('MØTE') || t.includes('MEETING')) return 'Meeting'
  if (t.startsWith('KURS') || t.startsWith('SPESIALKURS'))                 return 'Training'
  if (t.startsWith('RAZZIA') || t.startsWith('TELAVÅG'))                  return 'Raid'
  if (t.startsWith('SABOTASJE') || t.startsWith('TIRPITZ')) return 'Sabotage'
  if (t.startsWith('PLANET')) return 'PlanetOperation'
  return 'Narrative'
}

// ── Extractors (per group) ────────────────────────────────────────────────────

function extractAirMission(title: string, text: string, issues: string[]) {
  const extracted: Record<string, unknown> = {}

  // BBC signal: "Særmelding BBC : "phrase""
  const bbcMatch = text.match(/s[æa]rmelding\s+bbc\s*[:–-]\s*["""«]([^"""»\n]+)["""»]/i)
  if (bbcMatch) extracted['bbcSignal'] = bbcMatch[1].trim()

  // Drop zone code: "Code : XXXXX"
  const codeMatch = text.match(/code\s*[:–-]\s*([A-ZÆØÅ0-9 _-]{2,30})/i)
  if (codeMatch) extracted['dropZoneCode'] = codeMatch[1].trim()

  // Aircraft types
  const aircraftTypes = [...new Set([
    ...text.matchAll(/\b(Halifax|Stirling|Liberator|Hudson|Catalina|Dakota|Lysander|Mosquito|Lancaster|Sunderland)\s+([IVXLCDM]+|[A-Z]{1,3})\s+([A-Z]{1,2}\d{3,4})/gi),
  ].map(m => ({ type: m[1], mark: m[2], serial: m[3] })))]
  if (aircraftTypes.length) extracted['aircraft'] = aircraftTypes

  // Squadron: "Squad: RAF 644/298" or "No. 138 Sqn"
  const squadMatch = text.match(/squad(?:ron)?\s*[:–-]?\s*(?:RAF\s+)?(\d[\d/]+)/i)
  if (squadMatch) extracted['squadron'] = squadMatch[1].trim()

  // Operation code name from title: "SOE Operation CRUPPER XXXXIV"
  const opMatch = title.match(/(?:SOE|SIS)\s+Operation\s+([A-ZÆØÅ]+)/i)
  if (opMatch) extracted['operationName'] = opMatch[1].toUpperCase()

  // Container/package counts
  const contMatch = text.match(/(\d+)\s+container/i)
  if (contMatch) extracted['containers'] = parseInt(contMatch[1])
  const packMatch = text.match(/(\d+)\s+pack(?:age)?/i)
  if (packMatch) extracted['packages'] = parseInt(packMatch[1])

  if (!extracted['bbcSignal'] && !(extracted['aircraft'] as unknown[])?.length && !extracted['operationName']) {
    issues.push('No BBC signal, aircraft or operation name found in description')
  }

  return extracted
}

function extractRadioStation(title: string, _text: string, issues: string[]) {
  const extracted: Record<string, unknown> = {}

  // Station code name: "SOE Station MOORHEN S: ..."
  const nameMatch = title.match(/station\s+([A-ZÆØÅ][A-ZÆØÅ0-9 _/-]*?)(?:\s+S:|\s+Aldri|$)/i)
  if (nameMatch) extracted['stationCode'] = nameMatch[1].trim().toUpperCase()
  else issues.push('Could not parse station code name from title')

  // Active dates: "S: 31/1-43 til 21/5-45"
  const datesMatch = title.match(/S:\s*([\d/-]+)\s+til\s+([\d/-]+)/i)
  if (datesMatch) {
    extracted['activeFrom'] = datesMatch[1].trim()
    extracted['activeTo']   = datesMatch[2].trim()
  }

  // Never transmitted
  if (/aldri sending/i.test(title)) extracted['neverTransmitted'] = true

  // Network (SOE vs SIS)
  extracted['network'] = title.toUpperCase().startsWith('SOE') ? 'SOE' : 'SIS'

  return extracted
}

function extractNNIUMission(title: string, _text: string, issues: string[]) {
  const extracted: Record<string, unknown> = {}

  // Sequence number
  const seqMatch = title.match(/NNIU\s+([\d.]+)/i)
  if (seqMatch) extracted['sequence'] = seqMatch[1]

  // Radio operator code: R.MARTIN, R: TERRACE
  const radioMatch = title.match(/R[.:]\s*([A-ZÆØÅ][A-ZÆØÅ0-9_-]+)/i)
  if (radioMatch) {
    extracted['radioOperator'] = radioMatch[1].toUpperCase()
    extracted['missionType'] = 'RadioContact'
  }

  // Mission sub-type from title keywords
  const t = title.toUpperCase()
  if (!extracted['missionType']) {
    if (t.includes('PICK UP') || t.includes('PICKUP') || t.includes(' PU ') || t.includes(' PU\t')) extracted['missionType'] = 'Pickup'
    else if (t.includes('LANDING') || t.includes('LAND ') || t.includes('LANDSETTING')) extracted['missionType'] = 'Landing'
    else if (t.includes('DUMP')) extracted['missionType'] = 'ArmsDump'
    else if (t.includes('RESCUE')) extracted['missionType'] = 'Rescue'
    else if (t.includes('ESCORT') || t.includes('ESCORTE')) extracted['missionType'] = 'Escort'
    else if (t.includes('MESSENGER') || t.includes('KURER') || t.includes('COURIER')) extracted['missionType'] = 'Courier'
    else { extracted['missionType'] = 'Unknown'; issues.push('Could not determine NNIU mission sub-type') }
  }

  // Operation name
  const opMatch = title.match(/(?:SOE|SIS)\s+(?:Operation|operasjon)\s+([A-ZÆØÅ]+)/i)
  if (opMatch) extracted['operationName'] = opMatch[1].toUpperCase()

  return extracted
}

function extractSeaPatrol(title: string, _text: string, issues: string[]) {
  const extracted: Record<string, unknown> = {}

  // MTB number: "MTB 141 Patrol VP 81"
  const mtbMatch = title.match(/MTB\s+(\d+)/i)
  if (mtbMatch) extracted['vesselNumber'] = mtbMatch[1]

  // Patrol ID: "VP 81"
  const vpMatch = title.match(/VP\s+([\d.]+)/i)
  if (vpMatch) extracted['patrolId'] = vpMatch[1]

  // Area: last part of title after last tab or the location name
  const parts = title.split(/\t+/)
  if (parts.length > 1) extracted['area'] = parts[parts.length - 1].trim()

  if (!extracted['vesselNumber']) issues.push('Could not parse vessel number')

  return extracted
}

function extractMaritimeCraft(title: string, _text: string, issues: string[]) {
  const extracted: Record<string, unknown> = {}

  // MK ID: "MK X81"
  const mkMatch = title.match(/MK\s+(X[\d]+|[\d]+)/i)
  if (mkMatch) extracted['craftId'] = mkMatch[1].toUpperCase()

  // Vessel name in quotes or after MS/MK designation
  const nameMatch = title.match(/"([^"]+)"/)
  if (nameMatch) extracted['vesselName'] = nameMatch[1]

  if (!extracted['craftId']) issues.push('Could not parse craft ID')

  return extracted
}

function extractCommandoRaid(title: string, _text: string, issues: string[]) {
  const extracted: Record<string, unknown> = {}
  // COHQ operation name: "COHQ Operation MUSKETOON"
  const opMatch = title.match(/COHQ\s+Operation\s+([A-ZÆØÅ]+)/i)
  if (opMatch) extracted['operationName'] = opMatch[1].toUpperCase()
  else issues.push('Could not parse COHQ operation name')
  // Norwegian name in parentheses: "(Lofotraid I)"
  const noMatch = title.match(/\(([^)]+)\)/)
  if (noMatch) extracted['norwegianName'] = noMatch[1].trim()
  return extracted
}

function extractGeneric(title: string, _text: string, issues: string[]) {
  const extracted: Record<string, unknown> = {}
  const opMatch = title.match(/(?:SOE|SIS)\s+(?:Operation|operasjon)\s+([A-ZÆØÅ]+)/i)
  if (opMatch) extracted['operationName'] = opMatch[1].toUpperCase()
  else issues.push('No operation name found')
  return extracted
}

// ── Date range extraction ─────────────────────────────────────────────────────

/** Parse "DD/M-YY" or "D/M-YYYY" title date format → ISO "YYYY-MM-DD" */
function parseTitleDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})-(\d{2,4})$/)
  if (!m) return null
  return parseLogDate(m[1], m[2], m[3])
}

/**
 * Extract a date range from:
 *  1. RadioStation title: "S: DD/M-YY til DD/M-YY"
 *  2. tidsrommet section: free text containing "DD/M-YY til DD/M-YY"
 */
function extractDateRange(
  title: string,
  sections: Record<string, string>,
): { startDate?: string; endDate?: string } {
  // Pattern 1 — RadioStation: "S: 31/1-43 til 21/5-45" or "S: 31/1-43 - 21/5-45"
  const stationMatch = title.match(/S:\s*(\d{1,2}\/\d{1,2}-\d{2,4})\s+(?:til|-)\s+(\d{1,2}\/\d{1,2}-\d{2,4})/i)
  if (stationMatch) {
    const s = parseTitleDate(stationMatch[1])
    const e = parseTitleDate(stationMatch[2])
    if (s || e) return { ...(s ? { startDate: s } : {}), ...(e ? { endDate: e } : {}) }
  }

  // Pattern 2 — tidsrommet section: "DD/M-YY til DD/M-YY" or "DD/M-YY - DD/M-YY"
  const tids = sections['tidsrommet']
  if (tids) {
    const tidsMatch = tids.match(/([\d]{1,2}\/[\d]{1,2}-[\d]{2,4})\s+(?:til|-+)\s+([\d]{1,2}\/[\d]{1,2}-[\d]{2,4})/i)
    if (tidsMatch) {
      const s = parseTitleDate(tidsMatch[1])
      const e = parseTitleDate(tidsMatch[2])
      if (s || e) return { ...(s ? { startDate: s } : {}), ...(e ? { endDate: e } : {}) }
    }
  }

  return {}
}

// ── Person name matching ──────────────────────────────────────────────────────

interface PersonRecord { slug: string; name: string }

/** Rank/role prefixes to strip before attempting name match */
const RANK_RE = /^(?:captain|capt\.?|lt\.?|col\.?|major|sgt\.?|cpl\.?|pvt\.?|f\/o|w\/o|p\/o|f\/lt|s\/ldr|g\/cpt|f\/sgt|flt\.?|sqn\/ldr|wof|flg\s*off|air\s*cdre?|cmdr?|mr\.?|mrs\.?|ms\.?|1\.\s*off(?:icer)?|kvm|k\/v|kaptein|kpl|løytnant|fenrik|sjømann|telegrafist|styrmann|rorsmann|navigatør|mekaniker|maskinmester|motormann|skipsfører|k\/o|o\/c)\s+/i

function normalizeName(s: string): string {
  return s.trim().toLowerCase()
    .replace(/\./g, ' ')
    .replace(/[,;/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanCandidate(line: string): string {
  return line
    .replace(/^[a-z]\/[a-z][:\s]+/i, '')  // strip inline role labels: k/o:, a:, b:
    .replace(RANK_RE, '')                  // strip rank prefix (requires trailing whitespace)
    .replace(/^[a-z]{1,4}[:\s]+/, '')      // strip remaining lowercase short role labels (kvm:, etc.)
    .replace(/\(.*?\)/g, '')               // strip parentheticals
    .replace(/\b\d{2,}\b/g, '')            // strip numbers ≥2 digits (serial numbers, years)
    .replace(/[,;/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface PersonIndex {
  byNormName: Map<string, PersonRecord[]>
  byLastWord: Map<string, PersonRecord[]>
}

/**
 * Strip trailing all-caps tokens (rank/org suffixes like "NNIU", "Lt", "Kpl")
 * that editors sometimes append to person names in the DB.
 * e.g. "Per Danielsen  NNIU" → "Per Danielsen"
 */
function stripTrailingSuffix(s: string): string {
  return s.replace(/\s+[A-ZÆØÅ][A-ZÆØÅ./-]{0,20}(\s+[A-ZÆØÅ][A-ZÆØÅ./-]{0,20})*\s*$/, '').trim()
}

function buildPersonIndex(people: PersonRecord[]): PersonIndex {
  const byNormName = new Map<string, PersonRecord[]>()
  const byLastWord = new Map<string, PersonRecord[]>()

  for (const p of people) {
    const norm = normalizeName(p.name)
    // Also index by name with trailing suffixes stripped
    const normCleaned = normalizeName(stripTrailingSuffix(p.name.replace(RANK_RE, '')))
    // Strip rank from the DB name before indexing by last word
    const stripped = normCleaned

    for (const key of new Set([norm, normCleaned])) {
      if (!byNormName.has(key)) byNormName.set(key, [])
      if (!byNormName.get(key)!.find(x => x.slug === p.slug))
        byNormName.get(key)!.push(p)
    }

    const words = stripped.split(' ').filter(w => w.length >= 2)
    if (words.length > 0) {
      const last = words[words.length - 1]
      if (!byLastWord.has(last)) byLastWord.set(last, [])
      if (!byLastWord.get(last)!.find(x => x.slug === p.slug))
        byLastWord.get(last)!.push(p)
    }
  }

  return { byNormName, byLastWord }
}

function matchPeopleInSections(
  sections: Record<string, string>,
  index: PersonIndex,
): MentionedPerson[] {
  const results: MentionedPerson[] = []
  const seenSlugs = new Set<string>()

  for (const [sectionKey, sectionText] of Object.entries(sections)) {
    if (!PEOPLE_SECTION_KEYS.has(sectionKey)) continue

    const candidates = sectionText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2 && !/^\d/.test(l))

    for (const raw of candidates) {
      const cleaned = cleanCandidate(raw)
      if (!cleaned || cleaned.length < 3) continue

      const norm = normalizeName(cleaned)

      // 1. Exact normalized full-name match
      const exact = index.byNormName.get(norm)
      if (exact?.length === 1) {
        const p = exact[0]
        if (!seenSlugs.has(p.slug)) {
          seenSlugs.add(p.slug)
          results.push({ slug: p.slug, name: p.name, section: sectionKey, confidence: 'high' })
        }
        continue
      }

      // 2. Unique last-word (last name) match
      const words = norm.split(' ').filter(w => w.length >= 2)
      if (words.length === 0) continue
      const lastWord = words[words.length - 1]
      const byLast = index.byLastWord.get(lastWord)
      if (byLast?.length === 1) {
        const p = byLast[0]
        if (!seenSlugs.has(p.slug)) {
          seenSlugs.add(p.slug)
          results.push({ slug: p.slug, name: p.name, section: sectionKey, confidence: 'medium' })
        }
      }
    }
  }

  return results
}

// ── Planet roster extraction ──────────────────────────────────────────────────

/**
 * Extract person names from Planet operation roster tables.
 *
 * Rows come in two tab-layout variants:
 *   A) "PlanetName [«Codename»]\t PersonName \t dd.mm.yyyy [\t dd.mm.yyyy]"
 *      — tab separates planet+codename from the name column (first 8 rows)
 *   B) "PlanetName [«Codename»]    PersonName    dd.mm.yyyy\t dd.mm.yyyy"
 *      — tab is only between the two date columns; name is fused into the first cell
 *
 * Strategy: try variant A first (name is cols[1] and is not a date).
 * Fall back to variant B: strip the planet-prefix and trailing dates from cols[0].
 */
const PLANET_ROW_START_RE = /^[A-ZÆØÅ][a-zæøå]+[\s\t]/
// Strips "PlanetName [«Codename»] " from the start of a string
const PLANET_PREFIX_RE   = /^[A-ZÆØÅ][a-zæøå]+\s+(?:[«""\u201c][^»""\u201d\t]+[»""\u201d]\s*)?/
// Strips one or more trailing dd.mm.yyyy dates (and surrounding whitespace)
const TRAILING_DATE_RE   = /(\s+\d{2}\.\d{2}\.\d{4})+\s*$/
const DATE_COL_RE        = /^\d{2}\.\d{2}\.\d{4}/

function extractPlanetPeople(content: string, index: PersonIndex): MentionedPerson[] {
  const results: MentionedPerson[] = []
  const seenSlugs = new Set<string>()

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!PLANET_ROW_START_RE.test(line)) continue

    const cols = line.split('\t').map(c => c.trim()).filter(Boolean)
    if (cols.length < 2) continue

    let rawName = ''

    // Variant A: cols[1] is the name (not a date)
    if (!DATE_COL_RE.test(cols[1])) {
      rawName = cols[1].replace(TRAILING_DATE_RE, '').trim()
    }

    // Variant B: name is embedded in cols[0] with planet-prefix and trailing date
    if (!rawName) {
      rawName = cols[0]
        .replace(PLANET_PREFIX_RE, '')   // strip "Venus «Codename» "
        .replace(TRAILING_DATE_RE, '')   // strip trailing dates
        .trim()
    }

    if (!rawName) continue

    const cleaned = cleanCandidate(rawName)
    if (!cleaned || cleaned.length < 3) continue

    const norm = normalizeName(cleaned)

    // 1. Exact full-name match
    const exact = index.byNormName.get(norm)
    if (exact?.length === 1) {
      const p = exact[0]
      if (!seenSlugs.has(p.slug)) {
        seenSlugs.add(p.slug)
        results.push({ slug: p.slug, name: p.name, section: 'planet-roster', confidence: 'high' })
      }
      continue
    }

    // 2. Unique last-name match
    const words = norm.split(' ').filter(w => w.length >= 2)
    if (!words.length) continue
    const lastWord = words[words.length - 1]
    const byLast = index.byLastWord.get(lastWord)
    if (byLast?.length === 1) {
      const p = byLast[0]
      if (!seenSlugs.has(p.slug)) {
        seenSlugs.add(p.slug)
        results.push({ slug: p.slug, name: p.name, section: 'planet-roster', confidence: 'medium' })
      }
    }
  }

  return results
}

// ── Planet structured extraction ──────────────────────────────────────────────

/** dd.mm.yyyy → "YYYY-MM-DD" */
function parseDMY(d: string, m: string, y: string): string {
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
}

const DMY_RE = /(\d{1,2})\.(\d{1,2})\.(\d{4})/g

/**
 * Parse the roster table from Planet event content.
 * Rows like:
 *   Venus «Ole»    Rolf Odden    25.10.1944    08.11.1944
 *   Venus "Pelle"  Andreas Bakken  12.07.1944
 *   Venus          Arne Arnesen    30.11.1944  27.12.1944
 */
function extractPlanetRoster(content: string): PlanetRosterEntry[] {
  const results: PlanetRosterEntry[] = []

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!PLANET_ROW_START_RE.test(line)) continue

    // Codename: any quoted text with « » or " " or " " etc.
    const codenameMatch = line.match(/[«""\u201c\u2018']([^»""\u201d\u2019'\t]{1,20})[»""\u201d\u2019']/)
    const codename = codenameMatch ? codenameMatch[1].trim() : null

    // Dates (dd.mm.yyyy) — first = arrived Sweden, second = Åhlby
    const dateMatches = [...line.matchAll(DMY_RE)]
    const arrivedSweden = dateMatches[0] ? parseDMY(dateMatches[0][1], dateMatches[0][2], dateMatches[0][3]) : null
    const aahlyDate     = dateMatches[1] ? parseDMY(dateMatches[1][1], dateMatches[1][2], dateMatches[1][3]) : null

    // Name: same two-variant logic as extractPlanetPeople
    const cols = line.split('\t').map(c => c.trim()).filter(Boolean)
    let rawName = ''
    if (cols.length >= 2 && !DATE_COL_RE.test(cols[1])) {
      rawName = cols[1].replace(TRAILING_DATE_RE, '').trim()
    }
    if (!rawName) {
      rawName = cols[0]
        .replace(PLANET_PREFIX_RE, '')
        .replace(TRAILING_DATE_RE, '')
        .trim()
    }
    // Strip WT suffix (radio operator designator that leaked into name column)
    rawName = rawName.replace(/\s+WT\s*$/, '').trim()

    // Require at least one date — filters out narrative and header lines
    if (!arrivedSweden) continue
    if (!rawName || rawName.length < 3) continue

    results.push({ codename, rawName, arrivedSweden, aahlyDate })
  }

  return results
}

/**
 * Parse location hierarchy lines from Planet event content.
 * Lines like:
 *   Venus SE  HQ   Aktiv  Ble flytta til Grøtdalen...
 *   Venus depot  Vest Femunden
 *   Venus amøbe D243 PLANLAGT
 *   Venus bi-cell Alvdal PLANLAGT
 */
function extractPlanetLocations(content: string, opName: string): PlanetLocationEntry[] {
  const results: PlanetLocationEntry[] = []
  const nameLc = opName.toLowerCase()

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line.toLowerCase().startsWith(nameLc)) continue

    const lc = line.toLowerCase()

    function extractStatus(s: string): string {
      if (/\bplanlagt\b/i.test(s)) return 'Planlagt'
      if (/\boppløst\b/i.test(s))  return 'Oppløst'
      if (/\bfullført\b/i.test(s)) return 'Fullført'
      return 'Aktiv'
    }

    let type = ''
    let kmlName = ''
    let status = 'Aktiv'
    let note: string | null = null

    if (/\b(se|no)\s+hq\b/i.test(lc) || /\bhq\b.*\baktiv\b/i.test(lc) || /\bhq\b/i.test(lc)) {
      type   = 'HQ'
      const region = /\bno\b/i.test(lc.split('hq')[0]) ? 'NO' : 'SE'
      kmlName = `${opName} ${region}`
      status  = extractStatus(line)
      // Everything after the status keyword is a note
      const statusRe = /\b(PLANLAGT|Oppløst|Fullført|Aktiv)\b/i
      const sm = line.match(statusRe)
      if (sm) note = line.slice((sm.index ?? 0) + sm[0].length).trim() || null
    } else if (/\bdepot\b/i.test(lc)) {
      type    = 'Depot'
      kmlName = `${opName} depot`
      status  = extractStatus(line)
    } else if (/\bamøbe\b/i.test(lc)) {
      type  = 'Amøbe'
      // Capture district code: "amøbe D243"
      const dm = line.match(/amøbe\s+(\S+)/i)
      kmlName = dm ? `${opName} amøbe ${dm[1]}` : `${opName} amøbe`
      status  = extractStatus(line)
    } else if (/\bbi-celle?\b/i.test(lc)) {
      type  = 'Bi-celle'
      // Capture place name: "bi-cell Alvdal" or "bi-celle OS"
      const pm = line.match(/bi-celle?\s+(\S+)/i)
      const place = pm?.[1] ?? ''
      kmlName = `${opName} bi-celle ${place}`
      status  = extractStatus(line)
    }

    if (type) {
      results.push({ kmlName, type, status, note })
    }
  }

  return results
}

/**
 * Extract operation name and region from a Planet event title.
 * "Planet VENUS (SE)" → { operationName: "Venus", region: "SE" }
 */
function extractPlanetMeta(title: string): { operationName: string; region: string } {
  const m = title.match(/PLANET\s+([A-ZÆØÅ]+)\s*\(?(SE|NO)\)?/i)
  return {
    operationName: m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : title,
    region:        m?.[2]?.toUpperCase() ?? 'SE',
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const events = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/sanity-event.json'), 'utf-8')
) as Record<string, unknown>[]

const rawPeople = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/sanity-person.json'), 'utf-8')
) as Array<{ name?: string; slug?: { current?: string } }>
const personRecords: PersonRecord[] = rawPeople
  .filter(p => p.name && p.slug?.current)
  .map(p => ({ name: p.name!.trim(), slug: p.slug!.current! }))
const personIndex = buildPersonIndex(personRecords)

const groupCounts: Record<string, number> = {}
const results: EventMeta[] = []

for (const event of events) {
  const title  = (event['title'] as string) ?? ''
  const slug   = ((event['slug'] as Record<string, unknown>)?.['current'] as string) ?? (event['_id'] as string) ?? ''
  const id     = (event['_id'] as string) ?? ''
  const text   = toText(event['description'])
  const issues: string[] = []

  const group = classify(title)
  groupCounts[group] = (groupCounts[group] ?? 0) + 1

  const extracted: Record<string, unknown> = (() => {
    switch (group) {
      case 'AirMission':    return extractAirMission(title, text, issues)
      case 'RadioStation':  return extractRadioStation(title, text, issues)
      case 'NNIUMission':   return extractNNIUMission(title, text, issues)
      case 'SeaPatrol':     return extractSeaPatrol(title, text, issues)
      case 'MaritimeCraft': return extractMaritimeCraft(title, text, issues)
      case 'CommandoRaid':  return extractCommandoRaid(title, text, issues)
      case 'Narrative':     return {}
      default:              return extractGeneric(title, text, issues)
    }
  })()

  const { sections, content } = extractSections(event['description'])
  const logEntries      = extractLogEntries(event['description'])
  const mentionedPeople = matchPeopleInSections(sections, personIndex)

  let planet: PlanetExtracted | undefined

  if (group === 'PlanetOperation') {
    for (const p of extractPlanetPeople(content, personIndex)) {
      if (!mentionedPeople.some(mp => mp.slug === p.slug)) mentionedPeople.push(p)
    }
    const { operationName, region } = extractPlanetMeta(title)
    planet = {
      operationName,
      region,
      roster:    extractPlanetRoster(content),
      locations: extractPlanetLocations(content, operationName),
    }
  }

  const { startDate, endDate } = extractDateRange(title, sections)

  results.push({ _id: id, slug, title, group, extracted, sections, content, logEntries, mentionedPeople, startDate, endDate, issues, planet })
}

// ── Write output ──────────────────────────────────────────────────────────────

const outPath = resolve(process.cwd(), 'data/sanity-event-meta.json')
writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n')

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nClassified ${events.length} events → data/sanity-event-meta.json\n`)
console.log('Group breakdown:')
for (const [group, count] of Object.entries(groupCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${group.padEnd(20)} ${String(count).padStart(5)}`)
}

const withIssues = results.filter(r => r.issues.length > 0)
console.log(`\nEvents with extraction issues: ${withIssues.length} / ${events.length}`)
console.log('\nSample issues per group:')
const seen = new Set<string>()
for (const r of withIssues) {
  const key = `${r.group}:${r.issues[0]}`
  if (!seen.has(key)) {
    seen.add(key)
    console.log(`  [${r.group}] ${r.issues[0]}`)
    console.log(`    → ${r.title}`)
  }
}

// ── Section summary ───────────────────────────────────────────────────────────
const sectionCounts: Record<string, number> = {}
for (const r of results) {
  for (const key of Object.keys(r.sections)) {
    sectionCounts[key] = (sectionCounts[key] ?? 0) + 1
  }
}
console.log('\nSections extracted:')
for (const [key, count] of Object.entries(sectionCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key.padEnd(20)} ${String(count).padStart(5)}`)
}

const withContent         = results.filter(r => r.content.length > 0).length
const totalLogEntries     = results.reduce((n, r) => n + r.logEntries.length, 0)
const withLogEntries      = results.filter(r => r.logEntries.length > 0).length
const totalMentioned      = results.reduce((n, r) => n + r.mentionedPeople.length, 0)
const withMentioned       = results.filter(r => r.mentionedPeople.length > 0).length
const highConf            = results.reduce((n, r) => n + r.mentionedPeople.filter(p => p.confidence === 'high').length, 0)
console.log(`\nUncategorized content: ${withContent} events`)
console.log(`Log entries: ${totalLogEntries} total across ${withLogEntries} events`)
console.log(`Mentioned people: ${totalMentioned} matches (${highConf} high-confidence) across ${withMentioned} events`)
