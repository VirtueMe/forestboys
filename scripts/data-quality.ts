/**
 * Audits Sanity data quality — invalid coords, missing slugs, empty descriptions, etc.
 * Run with: npx tsx scripts/data-quality.ts
 */

const PROJECT_ID = '7r6kqtqy'
const DATASET = 'production'
const CDN = `https://${PROJECT_ID}.apicdn.sanity.io/v2021-08-31/data/query/${DATASET}`

function sanityUrl(query: string): string {
  return `${CDN}?query=${encodeURIComponent(query)}`
}

async function fetchQuery<T>(query: string): Promise<T[]> {
  const res = await fetch(sanityUrl(query))
  if (!res.ok) throw new Error(`Sanity error: ${res.status}`)
  const data = await res.json() as { result?: T[] }
  return data.result ?? []
}

function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

type SanityDoc = {
  _id: string
  title?: string
  name?: string
  slug?: string
  lat?: number
  lng?: number
  description?: unknown[]
}

async function main() {
  console.log('=== Milorg Data Quality Audit ===\n')

  // --- Locations ---
  console.log('Fetching locations...')
  const locations = await fetchQuery<SanityDoc>(`*[_type == "location"]{
    _id, title, "slug": slug.current,
    "lat": coordinates.lat, "lng": coordinates.lng,
    description
  }`)

  const locInvalidCoords = locations.filter(l => !isValidCoord(l.lat, l.lng))
  const locMissingSlug = locations.filter(l => !l.slug)
  const locMissingTitle = locations.filter(l => !l.title)
  const locMissingDesc = locations.filter(l => !l.description || l.description.length === 0)

  console.log(`Locations total: ${locations.length}`)
  console.log(`  Invalid/missing coords: ${locInvalidCoords.length}`)
  if (locInvalidCoords.length) {
    locInvalidCoords.forEach(l => console.log(`    - ${l.title ?? l._id} (lat=${l.lat}, lng=${l.lng})`))
  }
  console.log(`  Missing slug: ${locMissingSlug.length}`)
  console.log(`  Missing title: ${locMissingTitle.length}`)
  console.log(`  Missing description: ${locMissingDesc.length}`)

  // --- Stations ---
  console.log('\nFetching stations...')
  const stations = await fetchQuery<SanityDoc>(`*[_type == "station"]{
    _id, title, "slug": slug.current,
    "lat": coordinates.lat, "lng": coordinates.lng,
    description
  }`)

  const staInvalidCoords = stations.filter(s => !isValidCoord(s.lat, s.lng))
  const staMissingSlug = stations.filter(s => !s.slug)
  const staMissingTitle = stations.filter(s => !s.title)

  console.log(`Stations total: ${stations.length}`)
  console.log(`  Invalid/missing coords: ${staInvalidCoords.length}`)
  if (staInvalidCoords.length) {
    staInvalidCoords.forEach(s => console.log(`    - ${s.title ?? s._id} (lat=${s.lat}, lng=${s.lng})`))
  }
  console.log(`  Missing slug: ${staMissingSlug.length}`)
  console.log(`  Missing title: ${staMissingTitle.length}`)

  // --- People ---
  console.log('\nFetching people...')
  const people = await fetchQuery<SanityDoc>(`*[_type == "person"]{
    _id, name, "slug": slug.current, description
  }`)

  const peopleMissingSlug = people.filter(p => !p.slug)
  const peopleMissingName = people.filter(p => !p.name)
  const peopleMissingDesc = people.filter(p => !p.description || p.description.length === 0)

  console.log(`People total: ${people.length}`)
  console.log(`  Missing slug: ${peopleMissingSlug.length}`)
  console.log(`  Missing name: ${peopleMissingName.length}`)
  console.log(`  Missing description: ${peopleMissingDesc.length}`)

  console.log('\n=== Done ===')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
