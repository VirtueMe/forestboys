/**
 * Fetches all Sanity data and writes it to idb-cache.json.
 * Run with: npx tsx scripts/fetch-idb-data.ts
 */

import { writeFileSync } from 'fs'
import type { IdbLocation, IdbStation, IdbPerson, IdbCache } from '../src/types/idb.ts'

const PROJECT_ID = '7r6kqtqy'
const DATASET = 'production'
const CDN = `https://${PROJECT_ID}.apicdn.sanity.io/v2021-08-31/data/query/${DATASET}`

function sanityUrl(query: string): string {
  return `${CDN}?query=${encodeURIComponent(query)}`
}

async function fetchAll<T>(query: string): Promise<T[]> {
  let results: T[] = []
  let lastId = ''
  const pageSize = 500

  while (true) {
    const paginated = lastId
      ? `${query} | order(_id asc) [0...${pageSize}] { _id, ... } [_id > "${lastId}"]`
      : `${query} | order(_id asc) [0...${pageSize}]`

    const res = await fetch(sanityUrl(paginated))
    if (!res.ok) throw new Error(`Sanity fetch failed: ${res.status}`)
    const data = await res.json() as { result?: T[] }
    const batch: T[] = data.result ?? []
    if (batch.length === 0) break
    results = results.concat(batch)
    // @ts-expect-error dynamic
    lastId = batch[batch.length - 1]._id
    if (batch.length < pageSize) break
    process.stdout.write('.')
  }
  console.log()
  return results
}

function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

async function main() {
  console.log('Fetching locations...')
  const rawLocations = await fetchAll<Record<string, unknown>>(`*[_type == "location"]{
    _id,
    title,
    "slug": slug.current,
    "lat": coordinates.lat,
    "lng": coordinates.lng,
    description,
    color,
    organizations,
    districts,
    "events": events[]->{_id, title, "slug": slug.current, date, organization, district},
    "gallery": gallery[]{_key, asset, caption},
    movie,
    links,
    "people": people[]->{_id, name, "slug": slug.current}
  }`)

  console.log('Fetching stations...')
  const rawStations = await fetchAll<Record<string, unknown>>(`*[_type == "station"]{
    _id,
    title,
    "slug": slug.current,
    type,
    "lat": coordinates.lat,
    "lng": coordinates.lng,
    description,
    "events": events[]->{_id, title, "slug": slug.current, date, organization, district},
    "gallery": gallery[]{_key, asset, caption},
    movie,
    links,
    "people": people[]->{_id, name, "slug": slug.current}
  }`)

  console.log('Fetching people...')
  const rawPeople = await fetchAll<Record<string, unknown>>(`*[_type == "person"]{
    _id,
    name,
    "slug": slug.current,
    secretName,
    home,
    birthYear,
    description,
    "events": events[]->{_id, title, "slug": slug.current, date, organization, district},
    "locations": locations[]->{_id, title, "slug": slug.current},
    "stations": stations[]->{_id, title, "slug": slug.current},
    outlines,
    "gallery": gallery[]{_key, asset, caption},
    movie,
    links
  }`)

  const locations: IdbLocation[] = rawLocations
    .filter(l => isValidCoord(l.lat, l.lng))
    .map(l => l as unknown as IdbLocation)

  const stations: IdbStation[] = rawStations
    .filter(s => isValidCoord(s.lat, s.lng))
    .map(s => s as unknown as IdbStation)

  const people: IdbPerson[] = rawPeople.map(p => p as unknown as IdbPerson)

  const skippedLocations = rawLocations.length - locations.length
  const skippedStations = rawStations.length - stations.length

  console.log(`Locations: ${locations.length} valid, ${skippedLocations} skipped (invalid coords)`)
  console.log(`Stations:  ${stations.length} valid, ${skippedStations} skipped (invalid coords)`)
  console.log(`People:    ${people.length}`)

  const cache: IdbCache = {
    version: 1,
    indexedAt: new Date().toISOString(),
    locations,
    stations,
    people,
    events: [],
    transport: [],
    outlines: [],
    orgColors: {},
    districtColors: {},
  }

  writeFileSync('idb-cache.json', JSON.stringify(cache, null, 2))
  console.log('Written to idb-cache.json')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
