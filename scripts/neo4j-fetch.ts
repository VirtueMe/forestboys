/**
 * Step 1: Fetch all event data from Sanity and save to data/sanity-events.json
 * Run with: npx tsx scripts/neo4j-fetch.ts
 */


const PROJECT_ID = '7r6kqtqy'
const DATASET    = 'production'
const CDN        = `https://${PROJECT_ID}.apicdn.sanity.io/v2021-08-31/data/query/${DATASET}`

async function fetchAll<T>(query: string): Promise<T[]> {
  let results: T[] = []
  let lastId = ''
  const pageSize = 500

  while (true) {
    const filter = lastId ? query.replace(']', ` && _id > "${lastId}"]`) : query
    const url = `${CDN}?query=${encodeURIComponent(`${filter} | order(_id asc) [0...${pageSize}]`)}`
    const res  = await fetch(url)
    if (!res.ok) throw new Error(`Sanity fetch failed: ${res.status}`)
    const json = await res.json() as { result: T[] }
    const page = json.result ?? []
    results = results.concat(page)
    if (page.length < pageSize) break
    lastId = (page[page.length - 1] as Record<string, unknown>)['_id'] as string
    process.stdout.write('.')
  }
  console.log()
  return results
}

async function main() {
  console.log('Fetching events from Sanity…')
  const events = await fetchAll<Record<string, unknown>>(`*[_type == "event"]{
    _id,
    title,
    "slug": slug.current,
    date,
    "organization": organization->name,
    "district":     district->name,
    "locationFrom": locationFrom->{_id, title, "slug": slug.current},
    "locationTo":   locationTo->{_id, title, "slug": slug.current},
    "stationFrom":  stationFrom->{_id, title, "slug": slug.current},
    "stationTo":    stationTo->{_id, title, "slug": slug.current},
    "people":       people[]->{_id, name, "slug": slug.current},
    "transport":    transport[]->{_id, name, "slug": slug.current}
  }`)
  console.log(`  ${events.length} events fetched`)

  process.stdout.write(JSON.stringify(events, null, 2) + '\n')
  process.stderr.write(`Done — ${events.length} events written to stdout\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
