# EVENT-DETAIL spec

## Source context

Original repo: `artemagvanian/milorg-2` (Vue 3, Vite, no Bootstrap, no Tailwind)
- `App.vue` wraps all views in `<keep-alive>` — component state persists across navigation
- Router uses `createWebHistory`, single `EventView` component at `/events/:slug?`
- `/directory` is a separate route (`DirectoryView`) — the table listing
- Colours come from `organization->color.hex` in Sanity, derived via `allLocationsQuery`
- No Bootstrap. No Tailwind (yet). Own CSS only.

---

## Routes

```
/events                        Hendelsekatalog: filters + timeline + list
/events/:slug                  Event detail page
/events/:slug#other-slug       Same page, different event detail visible
/directory                     Original table listing (keep as-is)
```

No `:child` param. Nav: "Hendelsekatalog" → `/events`.
Redirect: `/event/:slug` → `/events/:slug` (old URLs still work).

---

## `<keep-alive>` — what it means

All views are kept alive in memory. This has concrete implications:

- **`created()` fires once** — not on every navigation back to `/events`.
  Query A is fetched once and stays in memory. Never re-fetched.
- **Filter state persists** — when the user navigates to `/events/:slug`
  and returns, their org/district/search selections are exactly as left.
- **Back link is bare `/events`** — no need to encode filter state in the
  URL. The component remembers it.
- **`beforeRouteUpdate` is the correct hook** for responding to slug
  changes, since the component is never destroyed and recreated.
- **URL sync is critical** — because state persists across navigation,
  the URL must stay in sync with the live filter state or they drift.

---

## `/events` — Hendelsekatalog

One page, one filter state, two views of it.

### Layout

```
.events-page                   ← max-width: 1320px, margin: 0 auto
  .filters
    .search-input              ← "Søk etter hendelse…"
    CustomSelect               ← org (single-select, 22 orgs)
    CustomSelect               ← district (multi-select, all / org's districts)
  #timeline-embed              ← Timeline3, between filters and list
  .list-heading                ← "Hendelser (n)"
  .scroll-container            ← event rows
```

### Filter state

Initialised from URL query params (supports deep linking and reload):
```ts
const selectedOrg       = ref<string>(route.query.org as string ?? '')
const selectedDistricts = ref<string[]>(
  route.query.district
    ? (route.query.district as string).split(',').filter(Boolean)
    : []
)
const searchQuery = ref('')
```

### Org and district populations

**Org** — always all orgs, regardless of selection:
```ts
const orgOptions = computed(() =>
  [...new Set(allEvents.map(e => e.organization).filter(Boolean))].sort()
)
```

**District** — all districts when no org selected, narrows when org selected:
```ts
const districtOptions = computed(() => {
  if (!selectedOrg.value)
    return [...new Set(allEvents.map(e => e.district).filter(Boolean))].sort()
  return [...new Set(
    allEvents
      .filter(e => e.organization === selectedOrg.value)
      .map(e => e.district)
      .filter(Boolean)
  )].sort()
})
```

### Cascade

Selecting an org resets district selections:
```ts
watch(selectedOrg, () => { selectedDistricts.value = [] })
```

### URL sync

Must stay in sync because `<keep-alive>` means filter state outlives the
URL — if the user filters, navigates away and back, the URL must still
reflect what's displayed:
```ts
watch([selectedOrg, selectedDistricts], ([org, districts]) => {
  const query: Record<string, string> = {}
  if (org) query.org = org
  if ((districts as string[]).length) query.district = (districts as string[]).join(',')
  router.push({ query })
})
```

URL shapes:
```
/events
/events?org=02-SOE
/events?org=02-SOE&district=Milorg+D14.1
/events?org=02-SOE&district=Milorg+D14.1,Milorg+D14.2
```

`district` always comma-separated. Split on `,` when reading back.

### filteredEvents (shared by timeline and list)

```ts
const filteredEvents = computed(() =>
  allEvents.filter(e => {
    if (selectedOrg.value && e.organization !== selectedOrg.value) return false
    if (selectedDistricts.value.length &&
        !selectedDistricts.value.includes(e.district ?? ''))       return false
    if (searchQuery.value &&
        !e.title.toLowerCase().includes(searchQuery.value.toLowerCase())) return false
    return true
  })
)
```

Timeline and list always render from `filteredEvents` — same source, always in sync.

### Timeline3 click → navigate to event detail

```ts
tl.on('change', ({ unique_id }) => {
  if (unique_id) router.push({ name: 'events', params: { slug: unique_id } })
})
```

"Se mer" in list rows also navigates to `/events/:slug`.

---

## Component: `CustomSelect.vue`

Reusable custom dropdown. Used for both org (single-select) and district (multi-select).

### Props
```ts
props: {
  options:     { value: string; label: string }[]
  modelValue:  string | string[]
  placeholder: string
  multiple?:   boolean   // false = org, true = district
  disabled?:   boolean
}
emits: ['update:modelValue']
```

### Closed trigger label
```ts
const triggerLabel = computed(() => {
  if (!props.multiple) return (modelValue as string) || props.placeholder
  const sel = modelValue as string[]
  if (!sel.length)      return props.placeholder
  if (sel.length === 1) return sel[0]
  return `${sel.length} valgt`
})
```

### Template
```html
<div class="custom-select" :class="{ open: isOpen, disabled }">
  <div class="custom-select-trigger" @click="toggleOpen">
    <span>{{ triggerLabel }}</span>
    <span class="chevron">▾</span>
  </div>

  <div v-if="isOpen" class="custom-select-options">
    <!-- Single-select: clear option -->
    <div v-if="!multiple" class="custom-option" @click="select('')">
      {{ placeholder }}
    </div>
    <div
      v-for="opt in options" :key="opt.value"
      class="custom-option"
      :class="{ selected: isSelected(opt.value) }"
      :title="opt.label"
      @click="pick(opt.value)"
    >
      <span v-if="multiple" class="check">{{ isSelected(opt.value) ? '✓' : '' }}</span>
      {{ opt.label }}
    </div>
  </div>
</div>
```

### Behaviour
- **Single (org):** selecting emits value and closes
- **Multi (district):** selecting toggles, dropdown stays open, closes on click-outside
- `disabled` → non-interactive, greyed out
- `title` on each option — important for long names like
  "ANGLO-NORWEGIAN COLLABORATING COMMITEE" that get truncated visually

---

## `/events/:slug` — Event Detail

Since `App.vue` uses `<keep-alive>`, `EventView` is never destroyed when
navigating between `/events` and `/events/:slug`. Use `beforeRouteUpdate`
to respond to slug changes, not `created`.

### What this page is

A page about the slug event. The slug defines:
1. The page identity
2. The timeline scope — all events sharing slug event's org + district
3. The default visible detail — slug event shown when no hash present

### Route lifecycle

```ts
// On first load (created)
if (route.params.slug) {
  selectedSlug = route.params.slug
}

// On subsequent slug changes (keep-alive: component not recreated)
beforeRouteUpdate(to) {
  selectedSlug = to.params.slug ?? null
}
```

### Hash behaviour

Hash is a visibility switch on the detail panel only. Timeline scope never changes.

```
/events/gulltransporten-1940          → Gulltransporten detail shown
/events/gulltransporten-1940#other    → Other event detail shown, Gulltransporten hidden
```

```ts
const slugEvent    = computed(() => allEvents.find(e => e.slug === route.params.slug))
const hash         = computed(() => route.hash?.slice(1) ?? '')
const hashEvent    = computed(() => hash.value
  ? allEvents.find(e => e.slug === hash.value)
  : null
)
const visibleEvent = computed(() => hashEvent.value ?? slugEvent.value)
```

### Timeline scope

Always all events for the slug event's org + district — regardless of hash:

```ts
const timelineEvents = computed(() =>
  allEvents.filter(e =>
    e.organization === slugEvent.value?.organization &&
    e.district     === slugEvent.value?.district
  )
)
```

Scope is fixed from the slug. Hash does not change it. Timeline is
identical at `/events/slug` and `/events/slug#other`.

### Timeline interaction

```ts
tl.on('change', ({ unique_id }) => {
  if (!unique_id) return
  if (unique_id === route.params.slug) {
    router.replace({ hash: '' })              // slug event → clear hash
  } else {
    router.replace({ hash: '#' + unique_id }) // sibling → show sibling detail
  }
})
```

`router.replace` — hash swaps don't pollute browser history.

#### externalChange flag

When the hash changes via browser back/forward, the code calls
`tlInstance.goToId(target)` to sync the timeline's visible position.
`goToId()` fires Timeline3's `change` event internally, which would trigger
`router.replace` again — an infinite loop. `externalChange` breaks this:

```ts
// hash watcher
externalChange = true
tlInstance.goToId(target)   // fires 'change' internally

// change handler
if (externalChange) { externalChange = false; return }  // swallow it, reset
```

One-shot boolean: set immediately before the programmatic call, consumed and
cleared on the very next `change` event. Never set for user-driven timeline
clicks — those must route normally.

### Timeline highlighting

- Slug event: always highlighted (page anchor)
- Hash event: highlighted differently when present

### Image strategy

Timeline3 renders all slide DOM elements upfront — passing `media.url` for
every event would trigger thousands of image requests on init and stall
rendering. Media is therefore passed selectively:

| Route | Timeline3 `media.url` | List row thumbnails |
| --- | --- | --- |
| `/events` | First event only (index 0 — visible on load) | 40×40 `loading="lazy"` for all events |
| `/events/:slug` | Slug + hash event only (the hero slides) | Not shown (list hidden) |

On `/events` users get visual coverage from both layers: the timeline slide
shows the first event's image as a preview, and the list below shows
thumbnails for every event as the user scrolls. Clicking any marker navigates
to `/events/:slug` where that event's image becomes the slide hero.

On `/events/:slug` the slide area is the **visual heading** for the selected
event — `text.headline` (title) + `media.url` (gallery image) together form
the hero. `EventPanel` below is secondary content.

`thumbnailUrl` on `IdbEvent` is the first gallery image pre-resolved to a
Sanity CDN URL (`?w=400&auto=format`) by `galleryThumb()` during IDB cache
build. `buildTimelineData` upgrades it to `?w=1280&h=720&fit=crop` for the
slide area; list rows use `?w=80&h=80&fit=crop`.

**Trap:** `media` must be `undefined` when there is no image — never `''` or
`{ url: '' }`. Timeline3 treats any `media` object as "media is present" and
renders a broken `<img src="">`. The guard is:

```ts
media: showMedia && e.thumbnailUrl ? { url: ... } : undefined
```

`showMedia && e.thumbnailUrl` short-circuits to `undefined` (not `''`) when
either condition is false.

### Detail panel

Single panel, one event at a time:
```html
<EventPanel :event="visibleEvent" />
```

`EventPanel` renders: title, date, org, district, description,
people, locations, transport, gallery, links.

Data from Query B, fetched on demand, cached by slug.

### Layout

```
.events-page
  ‹ Tilbake
  [Org] · [District]    ← read-only context labels, not filters
  Timeline3             ← timelineEvents, slug + hash highlighted
  EventPanel            ← visibleEvent detail
```

### Back link

```html
<RouterLink to="/events">‹ Tilbake</RouterLink>
```

Bare `/events` — no query params. `<keep-alive>` means the `/events`
component still has the user's filter state in memory. It will be
exactly as left when they return.

---

## Route Table

| URL | Timeline scope | Detail panel | Back |
|-----|---------------|--------------|------|
| `/events` | All events | — | — |
| `/events?org=X` | Org X | — | — |
| `/events?org=X&district=Y,Z` | Org X + Districts Y, Z | — | — |
| `/events/:slug` | Slug's org+district | Slug event | `/events` |
| `/events/:slug#other` | Slug's org+district (unchanged) | Other event | `/events` |

---

## Colour Maps

Colours come from `organization->color.hex` in Sanity, derived via the
locations cache. Same source used for map markers — consistent across
the whole app.

Built when the locations cache is populated:
```ts
const orgColors: Record<string, string> = {}
const districtColors: Record<string, string> = {}

locations.forEach(loc => {
  if (!loc.color) return
  loc.organizations?.forEach(org => {
    if (!orgColors[org]) orgColors[org] = loc.color
  })
  loc.districts?.forEach(dist => {
    if (!districtColors[dist]) districtColors[dist] = loc.color
  })
})
```

Fallback maps (if locations cache not yet loaded):

```ts
const ORG_COLORS: Record<string, string> = {
  '01-SIS':                                          '#276a8b',
  '02-SOE':                                          '#276a8b',
  '03-Milorg':                                       '#0aa50a',
  '04-MTB flåten':                                   '#047485',
  '05-MSP Marinens skøyteavdeling Petershead':       '#31789b',
  '06-MK Skøyter':                                   '#276a8b',
  '07-NNIU - Norwegian Naval Independent Unit':      '#047485',
  '08-BOAC':                                         '#a2a00b',
  '09-Catalina trafikken':                           '#276a8b',
  '10-Flyktninger':                                  '#a1166a',
  '11-Grupper':                                      '#724a11',
  '12-Stockholm':                                    '#7b080e',
  '13-Ubåtene':                                      '#2f146e',
  'FO IV - MI 4':                                    '#e9748b',
  'Homefleet':                                       '#e38924',
  'Hærens Overkommando i London HOK':                '#ce3f06',
  'Norge i United Kingdom':                          '#0aa50a',
  'Nortraship':                                      '#24a3e3',
  'RAF/RCAF/RAAF/RNZAF':                             '#24a3e3',
  'RNNSU  Royal Norwegian Naval Special Unit ':      '#e324cc',
  'USSR':                                            '#276a8b',
}

const DISTRICT_COLORS: Record<string, string> = {
  '01- SIS-XU':                             '#276a8b',
  '02-SOE':                                 '#047485',
  '06 Skøyter ikke organisert':             '#276a8b',
  'A/U Patrol':                             '#24a3e3',
  'ANGLO-NORWEGIAN COLLABORATING COMMITEE': '#276a8b',
  'Den norske regjering':                   '#627202',
  'Flukt':                                  '#747b7e',
  'Grupper':                                '#724a11',
  'Holland':                                '#047485',
  'Hurtigruten':                            '#e38924',
  'Milorg D11':                             '#276a8b',
  'Milorg D12':                             '#276a8b',
  'Milorg D13':                             '#276a8b',
  'Milorg D14.1':                           '#0aa50a',
  'Milorg D14.2':                           '#276a8b',
  'Milorg D14.3':                           '#0aa50a',
  'Milorg D15':                             '#276a8b',
  'Milorg D16.1':                           '#276a8b',
  'Milorg D16.2':                           '#276a8b',
  'Milorg D16.3':                           '#276a8b',
  'Milorg D17':                             '#276a8b',
  'Milorg D18':                             '#276a8b',
  'Milorg D19':                             '#276a8b',
  'Milorg D20.1':                           '#276a8b',
  'Milorg D20.2':                           '#276a8b',
  'Milorg D20.3':                           '#276a8b',
  'Milorg D21':                             '#276a8b',
  'Milorg D22':                             '#276a8b',
  'Milorg D23':                             '#276a8b',
  'Milorg D24':                             '#276a8b',
  'Milorg D25':                             '#276a8b',
  'Milorg D26':                             '#276a8b',
  'Milorg D40':                             '#276a8b',
  'Norge':                                  '#a1166a',
  'RAF':                                    '#276a8b',
  'SOVJET':                                 '#276a8b',
  'Sverige':                                '#276a8b',
  'Sjur Østervold':                         '#31789b',
  'United Kingdom':                         '#724a11',
}
```

Helpers:
```ts
const orgColor      = (name: string) => (orgColors[name]      ?? ORG_COLORS[name])      ?? '#666'
const districtColor = (name: string) => (districtColors[name] ?? DISTRICT_COLORS[name]) ?? '#666'
```

### Applied in CustomSelect

**Org** — two valid implementations:

Option A — native `<select>` (no colour):
```html
<select v-model="selectedOrg">
  <option value="">Alle Organisasjoner</option>
  <option v-for="opt in orgOptions" :key="opt" :value="opt">{{ opt }}</option>
</select>
```

Option B — custom dropdown with coloured text:
```html
<!-- option -->
<div class="custom-option" :style="{ color: orgColor(opt.label) }" :title="opt.label">
  {{ opt.label }}
</div>
<!-- closed trigger -->
<span :style="{ color: orgColor(modelValue) }">{{ modelValue || placeholder }}</span>
```

**District** — coloured dot beside each option name:
```html
<!-- option -->
<div class="custom-option" :title="opt.label">
  <span class="color-dot" :style="{ background: districtColor(opt.label) }"></span>
  {{ opt.label }}
</div>

<!-- closed trigger: 1 selected -->
<span class="color-dot" :style="{ background: districtColor(modelValue[0]) }"></span>
{{ modelValue[0] }}

<!-- closed trigger: multiple selected -->
<span>{{ modelValue.length }} valgt</span>
```

```css
.color-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  flex-shrink: 0;
}
```

---

## Queries

### Query A — lean, fired once in `created()`

`<keep-alive>` means this fires only once per session, not on every navigation.

```groq
*[_type == "event"]{
  title,
  "slug": slug.current,
  date,
  "organization": organization->name,
  "district":     district->name
} | order(date asc)
```

- Size: ~306 KB (vs 23 MB fat query on prod)
- Time: ~780ms (vs 6.4s on prod)
- Feeds: dropdowns, Timeline3, event list, org→district map

### Query B — full detail, on demand per event

```groq
*[_type == "event" && slug.current == $slug][0]{
  title,
  "slug": slug.current,
  date,
  "organization": organization->name,
  "district":     district->name,
  locationTo   ->{title, "slug": slug.current},
  locationFrom ->{title, "slug": slug.current},
  stationTo    ->{title, "slug": slug.current},
  stationFrom  ->{title, "slug": slug.current},
  description,
  "people":    coalesce(people[]   ->{name, description, "slug": slug.current}, []),
  "transport": coalesce(transport[]->{name, description, "slug": slug.current}, []),
  "gallery":   coalesce(gallery, []),
  "movie":     movie.asset->url,
  "links":     coalesce(links[]{title, link}, [])
}
```

Fired when `visibleEvent` changes, cached by slug:
```ts
const detailCache = reactive<Record<string, EventDetail>>({})

watch(visibleEvent, async (event) => {
  if (!event || detailCache[event.slug]) return
  detailCache[event.slug] = await fetchDetail(event.slug)
})
```

---

## Acceptance Criteria

### Routes
- [ ] `/event/:slug` redirects to `/events/:slug`
- [ ] Nav "Hendelsekatalog" → `/events`
- [ ] No `:child` param anywhere
- [ ] `/directory` kept as-is

### `/events` filter
- [ ] Org always shows all 22 orgs
- [ ] District shows all districts when no org selected
- [ ] Selecting org: district narrows, district selections reset
- [ ] Deselecting org: district returns to all, selections clear
- [ ] Multiple districts selectable simultaneously
- [ ] URL: `?district=X,Y` comma-separated
- [ ] Reload with `?org=X&district=Y,Z` restores both filters
- [ ] Trigger shows "N valgt" when multiple districts selected

### `/events` timeline + list
- [ ] Timeline and list always show identical filtered set
- [ ] Filter change rerenders both together
- [ ] Clicking timeline event navigates to `/events/:slug`
- [ ] "Se mer" in list navigates to `/events/:slug`

### `/events/:slug`
- [ ] `beforeRouteUpdate` used for slug changes (not `created`)
- [ ] No hash → slug event detail shown
- [ ] Hash → hash event detail shown, slug detail hidden
- [ ] Clicking slug event in timeline → clears hash → slug detail returns
- [ ] Clicking sibling → hash pushed → sibling detail shown
- [ ] Hash changes use `router.replace`
- [ ] Timeline scope fixed to slug's org+district, unaffected by hash
- [ ] Slug event highlighted on load
- [ ] Hash event highlighted differently
- [ ] Org + District shown as read-only context labels
- [ ] Back link → bare `/events` (no query params)

### keep-alive
- [ ] Navigating `/events` → `/events/:slug` → back: filter state preserved
- [ ] Query A fires only once per session, not on return navigation

### Queries
- [ ] App load fires Query A only (not fat query)
- [ ] Query A ≤ 400 KB
- [ ] Query B fires on first visit per event, cached on repeat
- [ ] No detail fields in Query A