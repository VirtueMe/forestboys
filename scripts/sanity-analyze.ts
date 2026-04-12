/**
 * Classifies each Sanity event document into a group and extracts structured
 * nodes from the description text. Writes data/sanity-event-meta.json.
 *
 * Run with: npx tsx scripts/sanity-analyze.ts
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

// ── Types ─────────────────────────────────────────────────────────────────────

type Group =
  | 'AirMission'
  | 'RadioStation'
  | 'NNIUMission'
  | 'SeaPatrol'
  | 'MaritimeCraft'
  | 'StationOperation'
  | 'CommandoRaid'
  | 'EscapeRoute'
  | 'Meeting'
  | 'Training'
  | 'Raid'
  | 'Sabotage'
  | 'Narrative'
  | 'Unknown'

interface EventMeta {
  _id: string
  slug: string
  title: string
  group: Group
  extracted: Record<string, unknown>
  issues: string[]
}

// ── Portable text → plain text ────────────────────────────────────────────────

function toText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return (blocks as Record<string, unknown>[])
    .filter(b => b['_type'] === 'block')
    .map(b => ((b['children'] as Record<string, unknown>[]) ?? []).map(c => (c['text'] as string) ?? '').join(''))
    .join('\n')
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
  if (t.startsWith('SABOTASJE') || t.startsWith('TIRPITZ') || t.startsWith('PLANET')) return 'Sabotage'
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

// ── Main ──────────────────────────────────────────────────────────────────────

const events = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/sanity-event.json'), 'utf-8')
) as Record<string, unknown>[]

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

  results.push({ _id: id, slug, title, group, extracted, issues })
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
