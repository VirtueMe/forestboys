/**
 * Parses Planet_kart_Norge_1944-45.kml and outputs data/planet-kml.json.
 *
 * Run with:
 *   npx tsx scripts/planet-kml-parse.ts [path/to/kml]
 *
 * Default KML path: ~/Downloads/Planet kart Norge 1944-45.kml
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KmlPoint {
  name:        string
  lat:         number
  lng:         number
  type:        'HQ' | 'Depot' | 'Amøbe' | 'Bi-celle' | 'Unknown'
  description: string | null
}

export interface KmlRoute {
  name:   string
  type:   'Forbindelse' | 'Kurerrute' | 'Grenseovergang' | 'Unknown'
  status: 'Aktiv' | 'Planlagt' | 'Antatt'
  /** [lng, lat] pairs in GeoJSON order */
  coords: Array<[number, number]>
}

export interface PlanetKml {
  points: KmlPoint[]
  routes: KmlRoute[]
}

// ── Type inference ─────────────────────────────────────────────────────────────

function inferLocationType(name: string): KmlPoint['type'] {
  const n = name.toLowerCase()
  if (n.includes('depot'))                               return 'Depot'
  if (n.includes('amøbe') || n.includes('amoebe'))      return 'Amøbe'
  if (n.includes('bi-celle') || n.includes('bi-cell'))  return 'Bi-celle'
  // HQ: name ends with SE or NO (e.g. "Venus SE", "Pallas NO")
  if (/\b(se|no)\s*$/i.test(name))                      return 'HQ'
  return 'Unknown'
}

/** Map KML styleUrl id → route type and status */
function inferRouteProps(styleId: string): { type: KmlRoute['type']; status: KmlRoute['status'] } {
  if (styleId.includes('0F9D58') || styleId.includes('7CB342')) return { type: 'Forbindelse',    status: 'Aktiv'   }
  if (styleId.includes('000000'))                                return { type: 'Forbindelse',    status: 'Planlagt' }
  if (styleId.includes('0288D1'))                                return { type: 'Kurerrute',      status: 'Antatt'  }
  if (styleId.includes('FF5252'))                                return { type: 'Grenseovergang', status: 'Aktiv'   }
  return { type: 'Unknown', status: 'Aktiv' }
}

// ── Simple regex-based KML parser ─────────────────────────────────────────────

function parseKml(xml: string): PlanetKml {
  const points: KmlPoint[] = []
  const routes: KmlRoute[] = []

  // ── Point Placemarks from Planet-Amoeba-Bi-cell-Depot folder ────────────────

  // Isolate just the folder contents (everything between the folder's inner
  // content tags, not including other folders that might be nested later)
  const folderStart = xml.indexOf('<name>Planet-Amoeba-Bi-cell-Depot</name>')
  let folderXml = ''
  if (folderStart !== -1) {
    const afterName = xml.indexOf('</name>', folderStart) + '</name>'.length
    // Find the matching </Folder>
    let depth  = 1
    let cursor = afterName
    while (cursor < xml.length && depth > 0) {
      const nextOpen  = xml.indexOf('<Folder>', cursor)
      const nextClose = xml.indexOf('</Folder>', cursor)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++
        cursor = nextOpen + '<Folder>'.length
      } else {
        depth--
        cursor = nextClose + '</Folder>'.length
      }
    }
    folderXml = xml.slice(afterName, cursor - '</Folder>'.length)
  }

  const pmRe = /<Placemark>([\s\S]*?)<\/Placemark>/g
  let m: RegExpExecArray | null

  while ((m = pmRe.exec(folderXml)) !== null) {
    const pm = m[1]
    if (!pm.includes('<Point>')) continue

    const nameM  = pm.match(/<name>([\s\S]*?)<\/name>/)
    const coordM = pm.match(/<coordinates>\s*([\d.,\s-]+)\s*<\/coordinates>/)
    const descM  = pm.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ??
                   pm.match(/<description>([\s\S]*?)<\/description>/)
    if (!nameM || !coordM) continue

    const name = nameM[1].trim()
    const parts = coordM[1].trim().split(',')
    const lng   = parseFloat(parts[0])
    const lat   = parseFloat(parts[1])
    if (isNaN(lat) || isNaN(lng)) continue

    points.push({
      name,
      lat,
      lng,
      type:        inferLocationType(name),
      description: descM
        ? descM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null
        : null,
    })
  }

  // ── LineString Placemarks (routes) — anywhere in the document ───────────────

  const allPmRe = /<Placemark>([\s\S]*?)<\/Placemark>/g
  while ((m = allPmRe.exec(xml)) !== null) {
    const pm = m[1]
    if (!pm.includes('<LineString>')) continue

    const nameM  = pm.match(/<name>([\s\S]*?)<\/name>/)
    const styleM = pm.match(/<styleUrl>#([^<]+)<\/styleUrl>/)
    const coordM = pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/)
    if (!coordM) continue

    const name    = nameM?.[1].trim() ?? ''
    const styleId = styleM?.[1] ?? ''
    const { type, status } = inferRouteProps(styleId)

    const coords: Array<[number, number]> = coordM[1].trim()
      .split(/\s+/)
      .map(c => {
        const [lngStr, latStr] = c.split(',')
        return [parseFloat(lngStr), parseFloat(latStr)] as [number, number]
      })
      .filter(([lng, lat]) => !isNaN(lng) && !isNaN(lat))

    if (coords.length >= 2) {
      routes.push({ name, type, status, coords })
    }
  }

  return { points, routes }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const kmlPath = process.argv[2]
  ?? resolve(homedir(), 'Downloads', 'Planet kart Norge 1944-45.kml')

console.log(`Reading ${kmlPath}`)
const xml    = readFileSync(kmlPath, 'utf-8')
const result = parseKml(xml)

const outPath = resolve(process.cwd(), 'data', 'planet-kml.json')
writeFileSync(outPath, JSON.stringify(result, null, 2))

console.log(`  Points : ${result.points.length}`)
console.log(`  Routes : ${result.routes.length}`)
console.log(`Wrote → ${outPath}`)
