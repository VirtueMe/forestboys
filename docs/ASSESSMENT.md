# Assessment — milorg-2 (original source)

Original repo: `artemagvanian/milorg-2`  
Local reference: `/home/virtueme/github/milorg-2`

A factual record of what the original codebase does — architecture, patterns,
and limitations. No editorial. No comparisons to the rebuild.

---

## Stack

- **Vue 3** — Options API throughout (`data()`, `computed`, `methods`, `watch`)
- **Bootstrap 5** — all layout and component styling
- **Leaflet 1.9.4** — map with circle markers
- **@knight-lab/timelinejs 3.9.3** — installed as npm package
- **@sanity/client 6.18.2** — data layer, CDN mode
- **sanity-blocks-vue-component** — Portable Text renderer
- No TypeScript. No state management. No caching layer. No PWA.

---

## Routing

All routes support an optional `:slug?` parameter. `createWebHistory`. No wildcard catch-all.

```
/                 → HomeView
/about-us         → AboutUs
/directory        → DirectoryView    ← event table, same filters as EventView, no timeline
/events/:slug?    → EventView        ← timeline + filter dropdowns + detail panel
/locations/:slug? → LocationView     ← Leaflet map + detail panel
/outlines/:slug?  → OutlineView      ← select dropdown + detail
/people/:slug?    → PersonView       ← select dropdown + detail
/stations/:slug?  → StationView      ← Leaflet map + detail
/transport/:slug? → TransportView    ← select dropdown + detail
/not-found        → NotFound
```

---

## App.vue — keep-alive

All views are wrapped in `<keep-alive>`:

```vue
<router-view v-slot="{ Component }">
  <keep-alive>
    <component :is="Component" />
  </keep-alive>
</router-view>
```

Components are never destroyed when navigating away. `created()` fires once per
session. `beforeRouteUpdate` is the hook used for slug changes within a mounted view.

---

## Data fetching

### Three queries on EventView mount

```js
// EventView.vue — created()
this.events        = await client.fetch(allEventsQuery)        // fat query
this.organizations = await client.fetch(allOrganizationsQuery) // names only
this.districts     = await client.fetch(allDistrictsQuery)     // names only
```

`allOrganizationsQuery` and `allDistrictsQuery` return data that is entirely
derivable from the event records themselves.

### allEventsQuery — full field set, all 2163 events

```groq
*[_type == "event"] {
  title, "slug": slug.current, date,
  "organization": organization->name,
  "district":     district->name,
  locationTo->{title, "slug": slug.current},
  locationFrom->{title, "slug": slug.current},
  stationTo->{title, "slug": slug.current},
  stationFrom->{title, "slug": slug.current},
  description,
  "people":    people[]->{name, description, "slug": slug.current},
  "transport": transport[]->{name, description, "slug": slug.current},
  gallery,
  "movie": movie.asset->url,
  links
}
```

Measured: ~23 MB over the wire, ~6.4 s on a slow connection.
Every field for every event fetched upfront, regardless of whether the user
opens any event detail.

### No caching

Data lives in component `data()`. A hard reload re-fetches everything. Navigating
between routes does not re-fetch (keep-alive preserves the data in memory), but
there is no persistence beyond the browser session.

---

## EventView.vue

### Filter state

```js
data() {
  return {
    selectedOrganization: null,
    selectedDistrict: null,
    selectedSlug: null,
    events: [], organizations: [], districts: [],
    loading: false, dataLoaded: false,
  }
}
```

Both filters are plain `<select class="form-select">` elements. No custom dropdown.
District is not scoped to the selected org — all districts always visible regardless
of org selection.

### Filter auto-set from slug

When a slug is present, `beforeRouteUpdate` sets the filter dropdowns to match
that event's org and district:

```js
beforeRouteUpdate(to, _, next) {
  if (to.params.slug) {
    this.selectedSlug = to.params.slug
    if (this.selectedOrganization != '') {
      this.selectedOrganization = this.selected.organization  // overwrites user's filter
    }
    if (this.selectedDistrict != '') {
      this.selectedDistrict = this.selected.district          // overwrites user's filter
    }
  } else {
    this.selectedSlug = null
    this.selectedOrganization = ''
    this.selectedDistrict = ''
  }
  next()
}
```

This means clicking any event on the timeline silently resets both filter dropdowns.

### filteredEvents

```js
filteredEvents() {
  return this.events
    .filter(e => this.selectedOrganization == '' ? true : e.organization == this.selectedOrganization)
    .filter(e => this.selectedDistrict == ''     ? true : e.district == this.selectedDistrict)
}
```

Single district filter (not multi-select). Timeline and detail panel both use
`filteredEvents`.

---

## TimelineInfo.vue

Timeline3 is mounted in `mounted()` and recreated whenever `events` changes (filter change).

### externalChange flag

Timeline3 fires `change` both on user interaction and when `goToId()` is called
programmatically. The component suppresses the spurious event with a flag:

```js
watch: {
  selectedSlug(newSlug) {
    this.externalChange = true
    this.$options.timeline.goToId(newSlug)
  }
}
```

The `change` listener is registered inside the `ready` event, so it is never
active during Timeline3's own init sequence:

```js
this.$options.timeline.on('ready', () => {
  this.$options.timeline.goToId(this.selectedSlug)
  this.$options.timeline.on('change', (data) => {
    if (!this.externalChange) {
      this.$emit('change', data.unique_id)
    } else {
      this.externalChange = false
    }
  })
})
```

### Gallery images in timeline

Each event's first gallery image is passed as `media.url` to Timeline3,
built via `@sanity/image-url` at 1280×720.

---

## DirectoryView.vue

Same org/district filter dropdowns as EventView. No timeline. Renders
filtered events as a Bootstrap table via `<table-field>`. Rows link to
`/events/:slug`.

---

## LocationView.vue / MapInfo.vue

### Leaflet setup

All 1095 locations rendered as `L.circle` markers at once on mount — no
clustering. Each marker has a click handler that emits the location slug.
Map instance stored in `this.$options.map` (not in `data()`).

### Colour derivation

Location colour is resolved in the GROQ query itself:

```groq
"color": events[0]->organization->color.hex
```

First event's organization colour used for the marker. If no events, no colour.

---

## Sanity schema (relevant fields)

### Event

`title`, `slug`, `date`, `organization` (ref), `district` (ref),
`locationFrom` (ref), `locationTo` (ref), `stationFrom` (ref), `stationTo` (ref),
`description` (Portable Text), `people[]` (refs), `transport[]` (refs),
`gallery[]` (image assets), `movie` (file asset), `links[]` (title + URL)

### Organization

`name`, `color.hex`

### District

`name`

---

## Component field library

All display-only, no logic:

- `TitleField.vue` — `<h2>` wrapper
- `DescriptionField.vue` — `sanity-blocks-vue-component` Portable Text renderer
- `TableField.vue` — Bootstrap table, supports router-links and external links
- `GalleryField.vue` — Bootstrap carousel
- `VideoField.vue` — `<video controls>`
