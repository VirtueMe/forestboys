# Milorg Utforsker — Rebuild Strategy

Why we are rebuilding, what we are building toward, and the decisions that shape
every implementation choice along the way.

---

## Why this matters

Jan Warberg and Rolf G. Halvorsen have spent a decade assembling primary source
research on the Norwegian resistance movement 1940–1945. The data — 1095 locations,
136 stations, 3758 people, 2163 events — is in Sanity and is largely complete.

The original site works on a desktop with a good connection. It does not work
on a phone, does not work offline, and takes 6–7 seconds to become interactive
even on a fast connection. Most people who would care about this material will
encounter it on a phone, possibly somewhere with poor connectivity — at a memorial
site, in a rural area, or on public transport.

The rebuild exists to make the research usable where and how people actually are.

---

## The fetch and cache problem

### What the original does

The original fires a single GROQ query returning every field for all 2163 events —
description, gallery, people, transport, links — before anything is shown.
This produces ~23 MB of JSON and takes ~6.4 seconds on a slow connection.
It is the correct approach for a desktop app with a fast connection and no
offline requirement. It is the wrong approach for everything else.

### What we do instead

**Query A — lean, once, cached**

```groq
*[_type == "event"]{ title, slug, date, organization->name, district->name }
```

~306 KB. Runs once on first visit, stored in IndexedDB. Every subsequent visit
— including hard reloads — reads from the local database in milliseconds.
This feeds the timeline, the event list, and the filter dropdowns.

**Query B — full detail, on demand, cached in memory**

Full field set fetched only when the user opens a specific event.
Cached by slug for the session so repeat visits to the same event are instant.

This split means the overwhelming majority of users — those browsing the timeline
and list without opening many individual events — transfer less than 2% of what
the original requires.

The same pattern applies to locations, stations, and people: lean data cached
in IndexedDB at startup, rich detail fetched only when needed.

---

## The map

The original map uses Leaflet with plain circle markers. At 1095 locations
rendered simultaneously with no clustering, it is slow to paint and impossible
to read at any zoom level that shows the whole country. On a phone it is not
really usable.

We use MapLibre GL JS with CARTO vector tiles. The difference is qualitative:

- **Vector tiles** render at any resolution, scale correctly on high-DPI screens,
  and pan and zoom smoothly with GPU acceleration
- **Clustering** collapses nearby markers at low zoom — the map is readable at
  every scale
- **Colour coding** by organisation and district — markers carry meaning, not
  just position
- **Touch** — pinch-zoom, momentum pan, and tap targets sized for fingers

The map is the central navigation surface of the app. Getting it right is not
a polish concern — it is the core of the browsing experience.

---

## Mobile first

The original was built for desktop. Navigation, layout, typography, and
interactive targets are all sized for a mouse on a large screen.

We build mobile first: every layout decision starts from a phone-sized viewport
and scales up. The bottom drawer on mobile becomes a sidebar on desktop. Touch
targets are sized correctly. The timeline is full viewport width. The event list
uses virtual scroll so 2163 rows never stress the DOM.

This is not a responsive skin applied after the fact. It is the foundation.

---

## CSS path: plain → Tailwind

The original uses Bootstrap 5. Bootstrap carries significant unused CSS, enforces
its own visual language, and makes it difficult to maintain a custom design
identity across a large component set.

We removed Bootstrap entirely. The current implementation uses plain CSS with
a fixed set of CSS custom properties:

```css
--color-bg, --color-surface, --color-border, --color-border-mid,
--color-handle, --color-text, --color-muted, --color-navy,
--color-red, --color-green, --color-you
```

This palette is the design system. Every colour decision in every component
traces back to these variables.

**Why not Tailwind now?**

Tailwind requires a stable design vocabulary before it adds value. Adding it
before the design is settled produces a mix of utility classes and exceptions
that is harder to maintain than either plain CSS or a properly configured
Tailwind setup.

**When Tailwind comes**

The custom properties map directly to Tailwind theme tokens. The migration
is a configuration exercise, not a rewrite: `--color-navy` becomes
`theme.colors.navy`, and utility classes replace the current class names
component by component. The palette does not change.

---

## TypeScript

The original is plain JavaScript. We use TypeScript strict throughout.

The dataset is large and the types are non-trivial — events reference locations,
stations, people, and transport; locations derive colours from events. Loose typing
across this graph would produce silent bugs that are hard to trace.

Strict TypeScript also documents the data shape in the code, which matters because
this project will be handed to a GitHub org (`motstandsbevegelsen`) and will need
to be maintained by people who did not build it.

---

## PWA and offline

`vite-plugin-pwa` generates a service worker that caches the app shell and
static assets. Combined with IndexedDB for Sanity data, the app is fully
functional offline after the first visit.

This is particularly relevant to the use case: someone visiting a memorial site
or researching in a location without reliable connectivity should not lose access
to the material.

---

## Ownership and transfer

The content belongs to Jan Warberg and Rolf G. Halvorsen. The stewardship
belongs to Benjamin Thomas. The repository will be transferred to the
`motstandsbevegelsen` GitHub organisation when the rebuild is stable.

Every decision about code structure, documentation, and TypeScript coverage
should account for the fact that future maintainers will not be the people
who built it. The code should be readable without knowing the history.
