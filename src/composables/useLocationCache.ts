import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import { ref } from 'vue'
import { SANITY_CDN, SANITY_IMG } from '../config/sanity.ts'
import type { IdbLocation, IdbStation, IdbPerson, IdbEvent, IdbTransport, IdbOutline, IdbCache, IdbEventDetail, SavedPosition, SavedMapState } from '../types/idb.ts'
import { blocksToHtml } from '../utils/portableText.ts'

interface MilorgDB extends DBSchema {
  cache: {
    key: string
    value: IdbCache
  }
  userPosition: {
    key: 'current'
    value: SavedPosition
  }
  mapState: {
    key: 'current'
    value: SavedMapState
  }
}

const DB_NAME = 'milorg-v7'
const DB_VERSION = 1
const STORE = 'cache' as const
const CACHE_KEY = 'v17'
const MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

// Convert Sanity Portable Text block array to a plain string.
// Each block becomes one paragraph; non-block types (images etc.) are skipped.
function blocksToText(blocks: unknown): string | undefined {
  if (!Array.isArray(blocks) || blocks.length === 0) return undefined
  const paragraphs: string[] = []
  for (const block of blocks) {
    if (
      block !== null &&
      typeof block === 'object' &&
      '_type' in block &&
      (block as { _type: string })._type === 'block' &&
      'children' in block &&
      Array.isArray((block as { children: unknown[] }).children)
    ) {
      const text = (block as { children: { text?: string }[] }).children
        .map(c => c.text ?? '').join('')
      if (text.trim()) paragraphs.push(text.trim())
    }
  }
  return paragraphs.length ? paragraphs.join('\n\n') : undefined
}

// Resolve the first gallery image to a CDN thumbnail URL.
// Sanity _ref format: image-{hash}-{WxH}-{ext}  →  {hash}-{WxH}.{ext}
function galleryThumb(gallery: unknown): string | undefined {
  if (!Array.isArray(gallery) || !gallery.length) return undefined
  const ref = (gallery[0] as { asset?: { _ref?: string } } | null)?.asset?._ref
  if (!ref || typeof ref !== 'string') return undefined
  const path = ref.replace(/^image-/, '').replace(/-(\w+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=400&auto=format`
}

// Store the Promise, not the resolved value — safe against concurrent callers.
// Reset to null on rejection so the next caller can retry.
let dbPromise: Promise<IDBPDatabase<MilorgDB>> | null = null

function getDb(): Promise<IDBPDatabase<MilorgDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MilorgDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('cache'))        database.createObjectStore('cache')
        if (!database.objectStoreNames.contains('userPosition')) database.createObjectStore('userPosition')
        if (!database.objectStoreNames.contains('mapState'))     database.createObjectStore('mapState')
      },
    }).catch(err => {
      console.error('[IDB] openDB failed:', err)
      dbPromise = null   // allow retry
      throw err
    })
  }
  return dbPromise
}

async function readCache(): Promise<IdbCache | null> {
  const database = await getDb()
  return (await database.get(STORE, CACHE_KEY)) ?? null
}

async function writeCache(cache: IdbCache): Promise<void> {
  const database = await getDb()
  await database.put(STORE, cache, CACHE_KEY)
}

export async function readUserPosition(): Promise<SavedPosition | null> {
  const database = await getDb()
  return (await database.get('userPosition', 'current')) ?? null
}

export async function saveUserPosition(pos: SavedPosition): Promise<void> {
  const database = await getDb()
  await database.put('userPosition', pos, 'current')
}

export async function readMapState(): Promise<SavedMapState | null> {
  const database = await getDb()
  return (await database.get('mapState', 'current')) ?? null
}

export async function saveMapState(state: SavedMapState): Promise<void> {
  const database = await getDb()
  await database.put('mapState', state, 'current')
}

function sanityUrl(query: string): string {
  return `${SANITY_CDN}?query=${encodeURIComponent(query)}`
}

async function fetchAll<T>(query: string): Promise<T[]> {
  let results: T[] = []
  let lastId = ''
  const pageSize = 500

  while (true) {
    const paginated = lastId
      ? `${query} | order(_id asc) [_id > "${lastId}"] [0...${pageSize}]`
      : `${query} | order(_id asc) [0...${pageSize}]`

    const res = await fetch(sanityUrl(paginated))
    if (!res.ok) throw new Error(`Sanity ${res.status}`)
    const data = await res.json()
    const batch: T[] = data.result ?? []
    if (batch.length === 0) break
    results = results.concat(batch)
    // @ts-expect-error dynamic
    lastId = batch[batch.length - 1]._id
    if (batch.length < pageSize) break
  }
  return results
}

function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    !isNaN(lat) && !isNaN(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

// Confirmed field names from curl against live API:
//   organization documents use "name" (not "title")
//   district documents use "name" (not "title")
//   coordinates is a geopoint: { _type, lat, lng }
//   gallery items: { _key, _type: "image", asset: { _ref: "image-{hash}-{WxH}-{ext}", _type: "reference" } }
//   events are reverse-referenced via *[_type == "event" && references(^._id)]

async function fetchFromSanity(): Promise<IdbCache> {
  const [rawLocations, rawStations, rawPeople, rawOrgs, rawEvents, rawTransport, rawOutlines] = await Promise.all([
    fetchAll<Record<string, unknown>>(`*[_type == "location"]{
      _id, title, "slug": slug.current,
      "lat": coalesce(coordinates.lat, lat),
      "lng": coalesce(coordinates.lng, lng),
      description, color,
      "events": *[_type == "event" && references(^._id)]{
        _id, title, "slug": slug.current, date,
        "organization": organization->name,
        "district": district->name
      },
      "gallery": gallery[]{_key, asset, caption},
      movie,
      "links": links[]{ _key, title, "url": link },
      "people": people[]->{_id, name, "slug": slug.current}
    }`),
    fetchAll<Record<string, unknown>>(`*[_type == "station"]{
      _id, title, "slug": slug.current, type,
      "lat": coalesce(coordinates.lat, lat),
      "lng": coalesce(coordinates.lng, lng),
      description,
      "events": *[_type == "event" && references(^._id)]{
        _id, title, "slug": slug.current, date,
        "organization": organization->name,
        "district": district->name
      },
      "gallery": gallery[]{_key, asset, caption},
      movie,
      "links": links[]{ _key, title, "url": link },
      "people": people[]->{_id, name, "slug": slug.current}
    }`),
    fetchAll<Record<string, unknown>>(`*[_type == "person"]{
      _id, name, "slug": slug.current, secretName, home, birthYear,
      description,
      "events": *[_type == "event" && references(^._id)]{
        _id, title, "slug": slug.current, date,
        "organization": organization->name,
        "district": district->name
      },
      "locations": *[_type == "location" && references(^._id)]{_id, title, "slug": slug.current} | order(title asc),
      "stations": *[_type == "station" && ^._id in people[]._ref]{_id, title, "slug": slug.current} | order(title asc),
      "outlines": *[_type == "outline" && references(^._id)]{_id, title, "slug": slug.current} | order(title asc),
      "gallery": gallery[]{_key, asset, caption},
      movie,
      "links": links[]{ _key, title, "url": link }
    }`),
    fetchAll<Record<string, unknown>>(`*[_type == "organization"]{ "name": name, "color": color.hex }`),
    fetchAll<Record<string, unknown>>(`*[_type == "event"]{
      _id, title, "slug": slug.current, date,
      "organization": organization->name,
      "district": district->name,
      "gallery": gallery[0..0]{asset}
    }`),
    fetchAll<Record<string, unknown>>(`*[_type == "transport"]{
      _id, name, "slug": slug.current, type, unit, regser, reserve,
      description,
      "events": *[_type == "event" && references(^._id)]{
        _id, title, "slug": slug.current, date,
        "organization": organization->name,
        "district": district->name
      },
      "gallery": gallery[]{_key, asset, caption},
      movie,
      "links": links[]{ _key, title, "url": link }
    }`),
    fetchAll<Record<string, unknown>>(`*[_type == "outline"]{
      _id, title, "slug": slug.current,
      description,
      "people": people[]->{_id, name, "slug": slug.current},
      "gallery": gallery[]{_key, asset, caption},
      movie,
      "links": links[]{ _key, title, "url": link }
    }`),
  ])

  const orgColors: Record<string, string> = {}
  for (const org of rawOrgs) {
    if (typeof org.name === 'string' && typeof org.color === 'string') {
      orgColors[org.name] = org.color
    }
  }

  // Derive district colours from events: district → colour of its org
  const districtColors: Record<string, string> = {}
  for (const loc of rawLocations) {
    for (const ev of (loc.events as Array<{ organization?: string; district?: string }> | null) ?? []) {
      if (ev.district && ev.organization && orgColors[ev.organization] && !districtColors[ev.district]) {
        districtColors[ev.district] = orgColors[ev.organization]
      }
    }
  }

  const events = (rawEvents as unknown as Array<Omit<IdbEvent, 'thumbnailUrl'> & { gallery?: unknown[] }>)
    .map(({ gallery, ...e }) => ({ ...e, thumbnailUrl: galleryThumb(gallery) }))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

  return {
    version: 1,
    indexedAt: new Date().toISOString(),
    locations: rawLocations
      .filter(l => isValidCoord(l.lat, l.lng))
      .map(l => {
        const events = (l.events as IdbEvent[] | null) ?? []
        return {
          ...l,
          coordinates:  { lat: l.lat as number, lng: l.lng as number },
          description:  blocksToText(l.description),
          thumbnailUrl: galleryThumb(l.gallery),
          events,
          organizations: [...new Set(events.map(e => e.organization).filter(Boolean))],
          districts:     [...new Set(events.map(e => e.district).filter(Boolean))],
        }
      }) as unknown as IdbLocation[],
    stations: rawStations
      .filter(s => isValidCoord(s.lat, s.lng))
      .map(s => ({
        ...s,
        coordinates:  { lat: s.lat as number, lng: s.lng as number },
        description:  blocksToText(s.description),
        thumbnailUrl: galleryThumb(s.gallery),
        events:       (s.events as IdbEvent[] | null) ?? [],
      })) as unknown as IdbStation[],
    people: rawPeople
      .map(p => ({
        ...p,
        description:     blocksToText(p.description),
        descriptionHtml: blocksToHtml(p.description) || undefined,
        thumbnailUrl:    galleryThumb(p.gallery),
        events:          (p.events as IdbEvent[] | null) ?? [],
      })) as unknown as IdbPerson[],
    events,
    transport: rawTransport
      .map(t => ({
        ...t,
        description:  blocksToText(t.description),
        thumbnailUrl: galleryThumb(t.gallery),
        events:       (t.events as IdbEvent[] | null) ?? [],
      } as IdbTransport))
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'nb')),
    outlines: rawOutlines
      .map(o => ({
        ...o,
        description:  blocksToText(o.description),
        thumbnailUrl: galleryThumb(o.gallery),
      } as IdbOutline))
      .sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? ''), 'nb')),
    orgColors,
    districtColors,
  }
}

export async function fetchEventDetail(id: string): Promise<IdbEventDetail> {
  const query = `*[_type == "event" && _id == "${id}"][0]{
  _id, title, "slug": slug.current, date,
  "organization": organization->name,
  "district": district->name,
  description,
  "gallery": gallery[]{_key, asset, caption},
  "links": links[]{_key, title, "url": link},
  "locationFrom": locationFrom->{_id, title, "slug": slug.current},
  "locationTo": locationTo->{_id, title, "slug": slug.current},
  "stationFrom": stationFrom->{_id, title, "slug": slug.current},
  "people": people[]->{_id, name, "slug": slug.current},
  "transport": transport[]->{name}
}`
  const res = await fetch(sanityUrl(query))
  if (!res.ok) throw new Error(`Sanity fetchEventDetail ${res.status}`)
  const data = await res.json()
  const raw = data.result as Record<string, unknown>
  return {
    ...raw,
    description: blocksToText(raw.description),
    thumbnailUrl: galleryThumb(raw.gallery),
  } as IdbEventDetail
}

const eventDetailCache = new Map<string, IdbEventDetail>()

export async function fetchEventDetailBySlug(slug: string): Promise<IdbEventDetail | null> {
  if (eventDetailCache.has(slug)) return eventDetailCache.get(slug)!
  const query = `*[_type == "event" && slug.current == "${slug}"][0]{
  _id, title, "slug": slug.current, date,
  "organization": organization->name,
  "district": district->name,
  description,
  "stationFrom": stationFrom->{ title, "slug": slug.current },
  "stationTo": stationTo->{ title, "slug": slug.current },
  "locationFrom": locationFrom->{ title, "slug": slug.current },
  "locationTo": locationTo->{ title, "slug": slug.current },
  "transport": transport[]->{ name, "slug": slug.current, type },
  "people": people[]->{ name, "slug": slug.current },
  "gallery": coalesce(gallery, []),
  "links": coalesce(links[]{ title, link }, [])
}`
  const res = await fetch(sanityUrl(query))
  if (!res.ok) throw new Error(`Sanity fetchEventDetailBySlug ${res.status}`)
  const data = await res.json()
  const raw = data.result as Record<string, unknown> | null
  if (!raw) return null
  const detail = {
    ...raw,
    thumbnailUrl: galleryThumb(raw.gallery),
  } as IdbEventDetail
  eventDetailCache.set(slug, detail)
  return detail
}

export function useLocationCache() {
  const locations = ref<IdbLocation[]>([])
  const stations = ref<IdbStation[]>([])
  const people = ref<IdbPerson[]>([])
  const events = ref<IdbEvent[]>([])
  const transport = ref<IdbTransport[]>([])
  const outlines  = ref<IdbOutline[]>([])
  const orgColors = ref<Record<string, string>>({})
  const districtColors = ref<Record<string, string>>({})
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function init() {
    try {
      const cached = await readCache()
      const now = Date.now()

      if (cached) {
        console.log(`[cache] hit — ${cached.locations.length} locations, indexed ${cached.indexedAt}`)
        locations.value = cached.locations
        stations.value = cached.stations
        people.value = cached.people
        events.value = cached.events ?? []
        transport.value = cached.transport ?? []
        outlines.value  = cached.outlines ?? []
        orgColors.value = cached.orgColors ?? {}
        districtColors.value = cached.districtColors ?? {}
        loading.value = false

        const age = now - new Date(cached.indexedAt).getTime()
        if (age > MAX_AGE_MS) {
          void backgroundSync()
        }
      } else {
        console.log('[cache] miss — fetching from Sanity')
        const fresh = await fetchFromSanity()
        console.log(`[cache] fetched ${fresh.locations.length} locations`)

        // Set data first — visible immediately even if IDB write fails
        locations.value = fresh.locations
        stations.value = fresh.stations
        people.value = fresh.people
        events.value = fresh.events
        transport.value = fresh.transport
        outlines.value  = fresh.outlines
        orgColors.value = fresh.orgColors
        districtColors.value = fresh.districtColors
        loading.value = false

        writeCache(fresh).catch(e => console.error('[IDB] writeCache failed:', e))
      }
    } catch (e) {
      console.error('[cache] init failed:', e)
      error.value = e instanceof Error ? e.message : String(e)
      loading.value = false
    }
  }

  async function backgroundSync() {
    try {
      console.log('[cache] background sync starting')
      const fresh = await fetchFromSanity()
      locations.value = fresh.locations
      stations.value = fresh.stations
      people.value = fresh.people
      events.value = fresh.events
      transport.value = fresh.transport
      outlines.value  = fresh.outlines
      orgColors.value = fresh.orgColors
      districtColors.value = fresh.districtColors
      writeCache(fresh).catch(e => console.error('[IDB] backgroundSync writeCache failed:', e))
      console.log('[cache] background sync complete')
    } catch (e) {
      console.error('[cache] backgroundSync fetch failed:', e)
    }
  }

  return { locations, stations, people, events, transport, outlines, orgColors, districtColors, loading, error, init }
}
