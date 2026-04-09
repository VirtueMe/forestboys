# Routing architecture

## Routes

```
/                          Home — welcome/orientation, Sanity `home` doc
/map                       Map explorer — clusters, filter panel, geolocation
/map/:slug/:child?         Map + location detail in sidebar; child = sub-entity slug
/events                    Hendelsekatalog — list + timeline, URL-synced filters
/events/:slug              Hendelsekatalog — detail mode, scoped timeline
/stations                  Stasjoner list
/station/:slug             Stasjon detail
/people                    Personer list — virtual scroll, search
/person/:slug/:child?      Person detail; child = sub-entity slug
/transport                 Fremdriftsmidler list
/transport/:slug/:child?   Fremdriftsmiddel detail
/outlines                  Oversikter list
/outlines/:slug            Oversikt detail
/registre                  Registre (stub)
/about                     Om oss

— Legacy redirects —
/event/:slug/:child?  →  /events/:slug
/directory            →  /events
```

## Vue Router config

```typescript
{ path: '/',                        component: HomeView },
{ path: '/map',                     component: MapView },
{ path: '/map/:slug/:child?',       component: MapView },
{ path: '/events',                  component: EventsView },
{ path: '/events/:slug',            component: EventsView },
{ path: '/event/:slug/:child?',     redirect: to => ({ path: `/events/${to.params.slug}` }) },
{ path: '/directory',               redirect: '/events' },
{ path: '/stations',                component: StationsView },
{ path: '/station/:slug',           component: StationDetail },
{ path: '/people',                  component: PeopleView },
{ path: '/person/:slug/:child?',    component: PersonDetail },
{ path: '/transport',               component: TransportView },
{ path: '/transport/:slug/:child?', component: TransportDetail },
{ path: '/outlines',                component: OutlinesView },
{ path: '/outlines/:slug',          component: OutlineDetail },
{ path: '/registre',                component: RegistreView },
{ path: '/about',                   component: AboutView },
```

---

## Top navigation

5 items — desktop top bar, mobile hamburger dropdown.

```text
Hjem  Hendelsekatalog  Kart  Registre  Om oss
```

Active route: underlined (desktop), navy highlight (mobile dropdown).
Mobile: hamburger toggles full-width dropdown panel; closes on navigation or outside tap.

---

## Registre — archive hub

`/registre` is a landing page linking to the four archive sections.
Each section keeps its own top-level path so that cross-links from the map,
events, and other views resolve correctly without indirection.

| Section | Path |
| --- | --- |
| Personer | `/people`, `/person/:slug/:child?` |
| Fremdriftsmidler | `/transport`, `/transport/:slug/:child?` |
| Stasjoner | `/stations`, `/station/:slug` |
| Annen informasjon | `/outlines`, `/outlines/:slug` |

---

## /events — unified EventsView

`/events` and `/events/:slug` both render `EventsView`. No separate EventDetail component.

**List mode (`/events`):**

- Timeline3 full-width, virtual scroll list below
- Filters (org SELECT, district CustomSelect, text search) synced to URL query params
- Selecting an event in the timeline sets `#slug` hash → event panel slides in without route change

**Detail mode (`/events/:slug`):**

- Timeline scoped to the slug event's org + district
- Filters shown as read-only context labels — changes do NOT sync to URL
- Back → bare `/events`

Hash navigation: `#event-slug` appended to either mode URL for in-page event panel without full navigation.

---

## /map — MapView with sidebar detail

`/map/:slug` opens the sidebar (AppDrawer → DetailView) for the location matching `:slug`.
`:child` is reserved for sub-entity context within the location detail.

Map behaviour per route:

| Route | Map behaviour |
| --- | --- |
| `/map` | Restore `mapState` from IndexedDB, or fitBounds on full dataset |
| `/map/:slug` | `map.flyTo(location.coordinates)` at zoom 14 |
| `/map/:slug/:child` | No additional map change |
| `/person/:slug` | No map change — person has no coordinates |

---

## Data relationships

```text
Location → Events    (location.events[])
Location → People    (location.people[] — convenience denormalization)

Event → People       (event.people[])
Event → Location     (event.location reference)

Person → Events      (person.events[] — primary relationship)
Person → Locations   (derived: person.events[].location — sparse, many empty)
Person → Stations    (person.stations[] — sparse)
```

Person connects to the graph **primarily through events**, not locations directly.
Correct traversal: `Location → Events → People`, not `Location → People`.

---

## Shareable URLs

Every entity is directly linkable. Opening a direct URL loads the entity from IndexedDB by slug.

```text
/map/oslo
/events/gulltransporten-1940
/person/leif-andreas-larsen-s-lt-nniu
/map/oslo/leif-andreas-larsen
/person/leif-andreas-larsen/gulltransporten-1940
```

---

## SPA routing on GitHub Pages

The app uses `createWebHistory`. A `404.html` in `public/` redirects deep links back to
`index.html` with the path encoded as a query param. The service worker handles navigation
requests for returning visitors.
