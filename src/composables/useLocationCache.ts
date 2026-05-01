import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import { ref } from 'vue'
import { SANITY_CDN } from '../config/sanity.ts'
import { neo4jQuery } from './useNeo4j.ts'
import type { IdbLocation, IdbStation, IdbPerson, IdbEvent, IdbTransport, IdbOutline, IdbCache, IdbEventDetail, SavedPosition, SavedMapState } from '../types/idb.ts'

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
// CACHE_KEY bumped: data now sourced from Neo4j (round-3 schema); invalidates
// any v17 Sanity-shaped cache from previous deployments.
const CACHE_KEY = 'v18-neo4j'
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

function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    !isNaN(lat) && !isNaN(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

// ── Neo4j-backed cache build ─────────────────────────────────────────────
// Same IdbCache output shape as the original Sanity fetch so all consumers
// (MapView, PeopleView, EventsView, every detail page) work unchanged.
//
// Coverage gaps vs the prior Sanity build (filled by future rounds):
//   - thumbnailUrl: always undefined (galleries not migrated yet — round-5
//     image work moves them to R2 with proper Source nodes)
//   - description: undefined for Person/Location/Station/Transport (those
//     descriptions weren't migrated yet; only Page/Unit/Org/Incident have
//     Description nodes today). Detail views render whatever's there.
//   - outlines: empty array (the Sanity "outline" concept is now split into
//     Article/Operation/EquipmentType/Source — see Registre's Informasjon
//     category for the new home)
//   - person.locations / person.stations / person.outlines: empty arrays
//     (these were Sanity reverse-refs; equivalent graph edges TBD)

interface IncidentRow {
  _id: string
  slug: string
  title: string
  date: string | null
  organization: string | null
  district: string | null
}

async function fetchFromNeo4j(): Promise<IdbCache> {
  const [
    rawLocations, rawStations, rawPeople, rawTransport,
    rawEvents, rawOrgs, rawDistricts,
  ] = await Promise.all([
    neo4jQuery<{ _id: string; slug: string; title: string; lat: number; lng: number; events: IncidentRow[] }>(
      `MATCH (l:Location)
       OPTIONAL MATCH (l)<-[:FROM|TO]-(i:Incident)
       OPTIONAL MATCH (i)-[:ORCHESTRATED_BY]->(org:Organization)
       OPTIONAL MATCH (i)-[:IN_DISTRICT]->(dist:Unit)
       WITH l,
            collect(CASE WHEN i IS NOT NULL THEN
              {_id: i.sanityId, slug: i.slug, title: i.title, date: i.date,
               organization: org.canonicalName, district: dist.canonicalName}
            END) AS events
       RETURN l.sanityId AS _id, l.slug AS slug, l.canonicalName AS title,
              l.lat AS lat, l.lng AS lng,
              [e IN events WHERE e IS NOT NULL] AS events`),

    neo4jQuery<{ _id: string; slug: string; title: string; type: string | null; lat: number; lng: number; events: IncidentRow[] }>(
      `MATCH (s:Station)
       OPTIONAL MATCH (s)<-[:FROM_STATION|TO_STATION]-(i:Incident)
       OPTIONAL MATCH (i)-[:ORCHESTRATED_BY]->(org:Organization)
       OPTIONAL MATCH (i)-[:IN_DISTRICT]->(dist:Unit)
       WITH s,
            collect(CASE WHEN i IS NOT NULL THEN
              {_id: i.sanityId, slug: i.slug, title: i.title, date: i.date,
               organization: org.canonicalName, district: dist.canonicalName}
            END) AS events
       RETURN s.sanityId AS _id, s.slug AS slug, s.canonicalName AS title,
              s.type AS type, s.lat AS lat, s.lng AS lng,
              [e IN events WHERE e IS NOT NULL] AS events`),

    neo4jQuery<{ _id: string; slug: string; name: string; secretName: string | null; home: string | null; birthYear: number | null; events: IncidentRow[] }>(
      `MATCH (p:Person)
       OPTIONAL MATCH (p)-[:INVOLVED_IN]->(i:Incident)
       OPTIONAL MATCH (i)-[:ORCHESTRATED_BY]->(org:Organization)
       OPTIONAL MATCH (i)-[:IN_DISTRICT]->(dist:Unit)
       WITH p,
            collect(CASE WHEN i IS NOT NULL THEN
              {_id: i.sanityId, slug: i.slug, title: i.title, date: i.date,
               organization: org.canonicalName, district: dist.canonicalName}
            END) AS events
       RETURN p.sanityId AS _id, p.slug AS slug, p.canonicalName AS name,
              p.secretName AS secretName, p.home AS home, p.birthYear AS birthYear,
              [e IN events WHERE e IS NOT NULL] AS events`),

    neo4jQuery<{ _id: string; slug: string; name: string; type: string | null; unit: string | null; regser: string | null; reserve: string | null; events: IncidentRow[] }>(
      `MATCH (t:Transport)
       OPTIONAL MATCH (t)<-[:USED]-(i:Incident)
       OPTIONAL MATCH (i)-[:ORCHESTRATED_BY]->(org:Organization)
       OPTIONAL MATCH (i)-[:IN_DISTRICT]->(dist:Unit)
       WITH t,
            collect(CASE WHEN i IS NOT NULL THEN
              {_id: i.sanityId, slug: i.slug, title: i.title, date: i.date,
               organization: org.canonicalName, district: dist.canonicalName}
            END) AS events
       RETURN t.sanityId AS _id, t.slug AS slug, t.canonicalName AS name,
              t.type AS type, t.rawUnit AS unit, t.regser AS regser, t.reserve AS reserve,
              [e IN events WHERE e IS NOT NULL] AS events`),

    // Lean events — for the global event list (timeline, filters, etc.).
    neo4jQuery<IncidentRow>(
      `MATCH (i:Incident)
       OPTIONAL MATCH (i)-[:ORCHESTRATED_BY]->(org:Organization)
       OPTIONAL MATCH (i)-[:IN_DISTRICT]->(dist:Unit)
       RETURN i.sanityId AS _id, i.slug AS slug, i.title AS title, i.date AS date,
              org.canonicalName AS organization, dist.canonicalName AS district
       ORDER BY i.date`),

    neo4jQuery<{ name: string; color: string | null }>(
      `MATCH (o:Organization) WHERE o.color IS NOT NULL
       RETURN o.canonicalName AS name, o.color AS color`),

    // District colours: for each district, take its most-frequent org's colour.
    neo4jQuery<{ district: string; color: string }>(
      `MATCH (i:Incident)-[:IN_DISTRICT]->(d:Unit)
       MATCH (i)-[:ORCHESTRATED_BY]->(o:Organization)
       WHERE d.canonicalName IS NOT NULL AND o.color IS NOT NULL
       WITH d.canonicalName AS district, o.color AS color, count(*) AS n
       ORDER BY district, n DESC
       RETURN district, head(collect(color)) AS color`),
  ])

  const orgColors: Record<string, string> = {}
  for (const r of rawOrgs) if (r.color) orgColors[r.name] = r.color

  const districtColors: Record<string, string> = {}
  for (const r of rawDistricts) districtColors[r.district] = r.color

  const events: IdbEvent[] = rawEvents.map(e => ({
    _id: e._id, title: e.title, slug: e.slug, date: e.date ?? '',
    organization: e.organization ?? undefined,
    district: e.district ?? undefined,
    thumbnailUrl: undefined,
  } as unknown as IdbEvent))

  return {
    version: 1,
    indexedAt: new Date().toISOString(),
    locations: rawLocations
      .filter(l => isValidCoord(l.lat, l.lng))
      .map((l): IdbLocation => ({
        _id: l._id, title: l.title, slug: l.slug,
        lat: l.lat, lng: l.lng,
        events: l.events,
        organizations: [...new Set(l.events.map(e => e.organization).filter((x): x is string => Boolean(x)))],
        districts:     [...new Set(l.events.map(e => e.district).filter((x): x is string => Boolean(x)))],
      })),
    stations: rawStations
      .filter(s => isValidCoord(s.lat, s.lng))
      .map((s): IdbStation => ({
        _id: s._id, title: s.title, slug: s.slug, type: s.type ?? undefined,
        lat: s.lat, lng: s.lng,
        events: s.events,
      })),
    people: rawPeople.map(p => ({
      _id: p._id, name: p.name, slug: p.slug,
      secretName: p.secretName ?? undefined,
      home: p.home ?? undefined,
      birthYear: p.birthYear ?? undefined,
      description: undefined, descriptionHtml: undefined,
      thumbnailUrl: undefined,
      events: p.events,
    } as unknown as IdbPerson)),
    events,
    transport: rawTransport
      .map(t => ({
        _id: t._id, name: t.name, slug: t.slug, type: t.type ?? undefined,
        unit: t.unit ?? undefined,
        regser: t.regser ?? undefined,
        reserve: t.reserve ?? undefined,
        description: undefined, thumbnailUrl: undefined,
        events: t.events,
      } as unknown as IdbTransport))
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'nb')),
    outlines: [] as IdbOutline[],
    orgColors,
    districtColors,
  }
}

// ── Legacy Sanity fetch (no longer called; kept as a documentation record
// of what the previous shape was — delete once Neo4j path proves out in
// production for a full deploy cycle).
async function fetchFromSanityUnused(): Promise<IdbCache> {
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
        console.log('[cache] miss — fetching from Neo4j')
        const fresh = await fetchFromNeo4j()
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
      const fresh = await fetchFromNeo4j()
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
