# Milorg 2 Utforsker — site description

## About the project

Milorg 2 is a decade-long primary source research project by Jan Warberg
(@Sizzling Viper) and Rolf G. Halvorsen (@Speedy Slash / "LB" = Like blid),
documenting the Norwegian resistance movement 1940–1945. The project is run
under the association "Motstandsbevegelsen i Norge 1940-1945", supported by
Forsvarsmuseet and Sparebankstiftelsen DNB.

The data is stored in Sanity CMS (project ID: 7r6kqtqy, dataset: production)
and currently served through a Vue/Netlify frontend at norskmotstandsbevegelse.no.
This repo is a ground-up rebuild — mobile-first, fast, fully navigable.

Jan's core discipline: "En påstand uten primærkilde har redusert verdi."
Every event is documented with archive references and primary source links,
many pointing to Nasjonalbiblioteket digitised books.

---

## Navigation structure

```
Hjem                /               Welcome page — cards from Sanity
Hendelsekatalog     /events         Browsable event catalogue with filters
Tidslinje           /timeline       Interactive timeline explorer
Kart                /map            Map explorer (the primary view)
Stasjoner           /stations       Radio stations and airfields
Personer            /people         People browser — 3,758 entries
Fremdriftsmiddler   /transport      Aircraft and vessels
Annen informasjon   /outlines       Other reference information
Om oss              /about          About the project and team
```

### Mobile navigation

On mobile the top nav collapses to a hamburger menu (≡). Tapping opens a
full-width dropdown listing all 9 nav items vertically. Active route is
highlighted. Tap outside or ≡ again to close.

---

## Pages

### Hjem — `/`

Welcome and orientation page. Content fetched from Sanity `home` document type:

```groq
*[_type == "home"][0] {
  description,
  "topCards": topCards[] { title, description, "imageUrl": image.asset->url },
  "bottomCards": bottomCards[] { title, description, "imageUrl": image.asset->url }
}
```

Structure: description string + 4 top cards + 2 bottom cards. Each card has
`title`, `description`, `imageUrl`. Rendered as a responsive card grid —
2 columns desktop, 1 column mobile. Fetched on demand, not cached in IndexedDB.

---

### Hendelsekatalog — `/events`

Browsable list of all events, filterable by organisation and district. Same
filter chips as the map view. Events sorted by date. Each event card links
to `/event/:slug`.

Sanity type: `event`
Key fields: title, slug, date, organization (ref), district (ref), description
(blocks), transport (ref), people (refs), route locations, gallery, links

Events are fetched on demand — descriptions can be thousands of words (e.g.
Gulltransporten 1940 has 20 blocks). Not stored in IndexedDB.

---

### Tidslinje — `/timeline`

Interactive timeline explorer. Events plotted chronologically on a horizontal
scrollable timeline from 1939 to 1945. Filter by organisation and district
(same dropdowns as original site). Clicking an event navigates to
`/event/:slug`. Shows event image, title, date.

The original site uses Timeline.js for this view.

---

### Kart — `/map`

The primary map explorer view. See `ROUTING.md` and `FILTERS.md` for full spec.

Key features:
- MapLibre GL JS with CARTO Voyager tiles
- Location and station markers, clustered
- Sidebar: nearest locations in bounds, sorted by map centre distance
- Filter panel: org/district chips, search, visningsfilter
- Shareable URL: `?lat=&lng=&z=&q=&si=`
- Geolocation: centres on user position, saved to IndexedDB
- Map state restored from IndexedDB on load

---

### Stasjoner — `/stations`

List and map of radio stations and airfields. 135 stations in the dataset.

Sanity type: `station`
Key fields: title, slug, type (e.g. "Airfield", radio station type),
coordinates, description (blocks), events, gallery, movie, links, people

Station types include: airfields (RAF, USAAF, Norwegian), radio stations
(SIS, XU, SOE, Soviet), MTB bases, fishing boat harbours.

---

### Personer — `/people`

Browsable list of 3,758 people. Searchable by name. Each person card links
to `/person/:slug`.

Sanity type: `person`
Key fields: name, slug, secretName, home, birthYear, description (blocks),
events (primary relationship), locations, stations, outlines, gallery, movie,
links

People connect to the graph primarily through `events[]` — not locations
directly. Leif Andreas Larsen (Shetlands-Larsen) has 68 events.

Fate notation used in event crew lists:
- `∞` = survived
- `✝` = killed in action

People list is sorted alphabetically. Foreign military personnel have rank
first (e.g. "2Lt Polansky Henry L").

---

### Fremdriftsmiddler — `/transport`

List of aircraft and vessels used in resistance operations. Rich data.

Sanity type: `transport`
Key fields: title (aircraft/vessel name), slug, route
(stationFrom → locationFrom → locationTo), people/crew, description, gallery,
links

Examples: Halifax bombers, Catalina flying boats, MTB vessels, fishing boats
(skøyter), submarines.

---

### Annen informasjon — `/outlines`

Reference articles and additional contextual information.

Sanity type: `outline`
Key fields: title, slug, description (blocks), links

---

### Om oss — `/about`

About the project. Fetched from Sanity `aboutUs` document type.

Content: background on the project, Jan Warberg and Rolf G. Halvorsen,
the association "Motstandsbevegelsen i Norge 1940-1945", sponsors
(Forsvarsmuseet, Sparebankstiftelsen DNB, Ola Dybwad Olsen AS), contact form.

---

## Data summary

| Entity        | Count  | Has coords | Primary relationship    |
|---------------|--------|------------|-------------------------|
| locations     | 1 094  | mostly     | → events                |
| stations      | 135    | mostly     | → events                |
| people        | 3 758  | no         | → events (primary)      |
| events        | ~2 188 | no (via location) | → locations, people, transport |
| transport     | unknown| no         | → events, people        |
| outlines      | unknown| no         | → people, locations     |

---

## Sanity document types

```
home          Welcome page cards
aboutUs       About page content
location      Resistance locations with coordinates
station       Radio stations and airfields
person        Resistance fighters, aircrew, agents
event         Operations and incidents
transport     Aircraft and vessels
outline       Reference articles
organization  Organisation definitions with colour
district      District definitions
partner       Project supporters/sponsors
airfield      (legacy or subset of station?)
```

---

## Colour system

Jan built a colour vocabulary for organisations — each has a hex colour used
for map markers, filter chips, and event tags. See `FILTERS.md` for the full
colour map.

Districts inherit their colour from the dominant organisation at their
associated locations. Most Milorg districts share the same blue (#276a8b).

---

## Ownership and stewardship

- **Jan Warberg** (@Sizzling Viper) — data, research, project founder
- **Rolf G. Halvorsen** (@Speedy Slash) — co-researcher, RAF/USAAF expertise
- **Benny Thomas** (Jan Benny Thomas, BANCS AS) — frontend architect
- **Benjamin Thomas** — long-term technical steward (planned)

Repo to be transferred to a GitHub organisation owned by
"Motstandsbevegelsen i Norge 1940-1945" when ready.

---

## Personutforsker — `/people` — implementation notes

### Overview

A full-page list of all 3,758 people, filtered in real time as the user types.
All data served from IndexedDB cache — no network call on load.

### Layout

```
┌─────────────────────────────────────────────────┐
│  Søk etter person...                            │
├─────────────────────────────────────────────────┤
│  [thumb]  Navn                      Hjemsted    │
│           Fødselsår · Dekknavn                  │
├─────────────────────────────────────────────────┤
│  [thumb]  Navn                      Hjemsted    │
│           Fødselsår · Dekknavn                  │
├─────────────────────────────────────────────────┤
│  ...                                            │
└─────────────────────────────────────────────────┘
  Viser 3 758 personer
```

### Search behaviour

- Filters in real time as user types
- Minimum 2 characters before filtering kicks in
- Matches against `name` and `secretName`
- Count below list: "Viser 47 av 3 758 personer"
- Each row is a router-link to `/person/:slug`

### Virtual scrolling — native implementation (no library)

Rendering 3,758 DOM rows at once freezes the browser. The original site is
slow precisely because it does this. Use native virtual scrolling instead —
only render what is visible in the viewport.

```typescript
const ITEM_HEIGHT = 64  // px — every row must be exactly this height
const BUFFER = 5        // extra rows above and below viewport

const scrollTop = ref(0)
const containerHeight = ref(0)

const visibleRange = computed(() => {
  const start = Math.max(0,
    Math.floor(scrollTop.value / ITEM_HEIGHT) - BUFFER)
  const end = Math.min(
    filteredPeople.value.length,
    Math.ceil((scrollTop.value + containerHeight.value) / ITEM_HEIGHT) + BUFFER
  )
  return { start, end }
})

const visiblePeople = computed(() =>
  filteredPeople.value.slice(visibleRange.value.start, visibleRange.value.end)
)

const totalHeight = computed(() =>
  filteredPeople.value.length * ITEM_HEIGHT
)

const offsetY = computed(() =>
  visibleRange.value.start * ITEM_HEIGHT
)
```

```vue
<div
  class="scroll-container"
  @scroll="scrollTop = $event.target.scrollTop"
  ref="containerRef"
>
  <!-- Full height spacer so scrollbar renders at correct size -->
  <div :style="{ height: totalHeight + 'px', position: 'relative' }">
    <!-- Only visible rows, offset to correct position -->
    <div :style="{ transform: `translateY(${offsetY}px)` }">
      <router-link
        v-for="person in visiblePeople"
        :key="person.slug"
        :to="`/person/${person.slug}`"
        class="person-row"
      >
        ...
      </router-link>
    </div>
  </div>
</div>
```

### Key requirements

- Fixed `ITEM_HEIGHT` of 64px — every row must be exactly this height
- Container must have fixed height with `overflow-y: auto`
- `containerHeight` measured via `ResizeObserver` on mount
- Reset `scrollTop` to 0 when search text changes
- This renders ~15-20 DOM nodes regardless of list size — instant scroll, zero jank

### Why the original site is slow

The original norskmotstandsbevegelse.no fetches all 3,758 people with full
description blocks, gallery, events, locations, outlines and stations — on
every page load, with no caching. The same query fires twice (duplicate
requests visible in network tab).

Our approach: lean data in IndexedDB, virtual scrolling in the DOM.
Result: instant load, instant filter, instant scroll.

---

## Fremdriftsmiddelutforsker — `/transport` — implementation notes

### Overview

995 transport entries — aircraft, vessels, submarines, fishing boats, MTBs.
The original site shows just a single dropdown ("Velg en fremdriftsmiddel") —
a massive improvement opportunity. Same virtual scrolling + search pattern
as Personutforsker.

### Data shape

Sanity type: `transport`

```typescript
interface Transport {
  title: string          // aircraft/vessel name e.g. "Halifax LW270"
  slug: string
  type: string           // dirty field — many inconsistent variants
  description: SanityBlock[] | null
  gallery: SanityImage[]
  people: Array<{ name: string; slug: string }>  // crew
  links: Array<{ title: string; link: string }>
}
```

Note: `type` field is very inconsistent in the data — values like
"Halifax V", "Halifax", "Four-engined heavy bomber", "Four-engined heavy bomber "
(with trailing space) all refer to similar aircraft. Do not rely on `type`
for filtering without normalisation. Index-time cleanup recommended.

### Count

995 entries — small enough that virtual scrolling is optional but good
practice to implement anyway for consistency with Personutforsker.

### Layout

Same pattern as Personutforsker — search box on top, virtual scrolled list below:

```
┌─────────────────────────────────────────────────┐
│  Søk etter fremdriftsmiddel...                  │
├─────────────────────────────────────────────────┤
│  [thumb]  Navn                          Type    │
│           Besetning: 3 personer                 │
├─────────────────────────────────────────────────┤
│  [thumb]  Navn                          Type    │
│           Besetning: 5 personer                 │
├─────────────────────────────────────────────────┤
│  ...                                            │
└─────────────────────────────────────────────────┘
  Viser 995 fremdriftsmidler
```

### Search behaviour

- Filters in real time as user types (min 2 chars)
- Matches against `title` and `type`
- Each row links to `/transport/:slug`
- Show count: "Viser 47 av 995 fremdriftsmidler"

### Virtual scrolling

Same implementation as Personutforsker — fixed ITEM_HEIGHT, offsetY transform,
full height spacer. 995 items is manageable without it but implement for
consistency.

### Data caching

Transport data should be indexed into IndexedDB alongside locations, stations
and people. Lean fields only for the list view (title, slug, type, thumbnailUrl,
people count). Full detail fetched on demand at `/transport/:slug`.

Add to `useLocationCache.ts` fetch sequence:
```typescript
const [locations, stations, people, transport] = await Promise.all([
  fetchLocations(),
  fetchStations(),
  fetchPeople(),
  fetchTransport(),
])
```

---

## Hendelsekatalog — `/events` — implementation notes

### Overview

2,163 events spanning 9 April 1940 to 29 December 1945. The original site
shows a plain table with two dropdowns (org + district). Our version gets
search + org chips + district chips + virtual scrolling — same pattern as
Personutforsker but with date sorting.

### Data shape (lean — for list and IndexedDB)

```typescript
interface EventListItem {
  title: string
  slug: string
  date: string           // ISO date e.g. "1943-02-16"
  organization: string   // resolved name e.g. "02-SOE"
  district: string       // resolved name e.g. "Milorg D20"
}
```

Full event detail (description, people, transport, gallery, links) is fetched
on demand at `/event/:slug` — not stored in IndexedDB. See architecture
decision in ROUTING.md.

### Count

2,163 events — virtual scrolling essential.

### Layout

```
┌─────────────────────────────────────────────────┐
│  [Org chips — same as map filter]               │
│  [District chips — collapsible]                 │
├─────────────────────────────────────────────────┤
│  Søk etter hendelse...                          │
├─────────────────────────────────────────────────┤
│  Dato        Tittel              Org  · Distrikt│
│  1943-02-16  Operasjon Gunnerside  SOE · D20    │
├─────────────────────────────────────────────────┤
│  Dato        Tittel              Org  · Distrikt│
│  ...                                            │
└─────────────────────────────────────────────────┘
  Viser 2 163 hendelser
```

### Filter behaviour

- Org chips filter by `organization` field (OR logic)
- District chips filter by `district` field (OR logic)
- Search filters by `title` (min 2 chars, real time)
- All three filters combine with AND logic
- Default sort: date ascending (chronological)
- No network call — all filtering from IndexedDB cache

### Chips

Same org chips (with colours) and district chips as the map filter panel.
Derived from `orgColors` and `districtColors` already in IndexedDB cache.
Chip state is independent from the map filter — selecting chips in
Hendelsekatalog does not affect the map and vice versa.

### Virtual scrolling

Same implementation as Personutforsker. Fixed ITEM_HEIGHT, offsetY transform.
2,163 items — virtual scrolling essential.

```typescript
const ITEM_HEIGHT = 56  // slightly shorter than people rows — no thumbnail
```

### Caching

The lean event list (title, slug, date, organization, district) should be
indexed into IndexedDB alongside locations. Add to fetch sequence:

```typescript
const [locations, stations, people, transport, events] = await Promise.all([
  fetchLocations(),
  fetchStations(),
  fetchPeople(),
  fetchTransport(),
  fetchEventList(),  // lean fields only
])
```

GROQ for lean event list:
```groq
*[_type == "event"] {
  title,
  "slug": slug.current,
  date,
  "organization": organization->name,
  "district": district->name
} | order(date asc)
```

### Data facts

- 2,163 events total
- Date range: 1940-04-09 (Gulltransporten) → 1945-12-29 (SOE Operation FARNBOROUGH V)
- 21 unique organisations
- 41 unique districts

---

## Tidslinje — `/timeline` — implementation notes

### Overview

Interactive timeline of all 2,163 events plotted chronologically from
1939 to 1945. The original site uses Timeline.js — a third-party library
that renders a horizontally scrollable timeline with event cards above
and a scrubber bar below.

### Original site behaviour

- Horizontal scrollable timeline from 1939 to 1945
- Events shown as cards with image, title, date
- Next/previous navigation arrows
- Zoom in/out controls
- Filter by org and district (dropdowns)
- Clicking an event shows the full event detail

### Our approach — manageable complexity

The Tidslinje is complex to build well. Priority is lower than the map,
catalogue and person views. Options:

**Option A — Reuse Timeline.js** (same as original site)
Embed Timeline.js, feed it our IndexedDB event data. Fast to implement,
proven to work. Downside: adds a dependency, style may not match our palette.

**Option B — Custom Vue timeline**
Build a custom horizontal timeline component. Full control over design and
behaviour. Higher effort.

**Recommendation:** Start with Option A using Timeline.js fed from IndexedDB
cache. Add org/district chip filters above the timeline (same chips as map
and Hendelsekatalog). Style to match the warm palette. Clicking any event
navigates to `/event/:slug`.

---

## Kart — already built

The Kart view is fully built as part of this project. It is not the original
site map — it is our new implementation with MapLibre, CARTO tiles, IndexedDB
cache, filter panel, geolocation, shareable URLs and virtual pagination.

See ROUTING.md and FILTERS.md for the complete specification.
Remaining work is Vue Router integration to move the map from `/` to `/map`.

### Filter integration

Same org/district chips as Hendelsekatalog — filter which events appear on
the timeline. No search box needed — the timeline is visual navigation.

---

## Kart — `/map` — implementation notes

### Overview

Fully built by us — not the original site map. Our implementation uses
MapLibre GL JS, CARTO Voyager tiles, IndexedDB cache, coloured org/district
filter panel, geolocation, shareable URLs (`?lat=&lng=&z=&q=&si=`),
virtual pagination and background sync.

See ROUTING.md and FILTERS.md for the complete specification.

### Remaining work

- Move from `/` to `/map` route via Vue Router
- Location/event/person detail routes from map context (`/map/:slug/:child?`)
- Future: date range filter to show only events within a time window