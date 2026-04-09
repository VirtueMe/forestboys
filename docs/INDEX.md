# Milorg Utforsker — Documentation Index

Entry point for all design and architecture documents.

---

## Top-level

| Document | Description |
|---|---|
| [STRATEGY.md](STRATEGY.md) | Why we're rebuilding and the decisions that shape every implementation choice |
| [ASSESSMENT.md](ASSESSMENT.md) | Factual record of the original milorg-2 codebase |
| [STACK.md](STACK.md) | Tech stack, CSS custom properties, Tailwind migration plan |
| [DATA.md](DATA.md) | Sanity schema, GROQ queries, IndexedDB caching strategy |
| [COLOURS.md](COLOURS.md) | Org and district colour maps, derivation and fallback |
| [DB.md](DB.md) | Long-term graph database consideration — note for the motstandsbevegelsen handoff |

---

## Views

| Document | Route | Description |
|---|---|---|
| [views/EVENTS.md](views/EVENTS.md) | `/events`, `/events/:slug` | Hendelsekatalog — filters, timeline, event list, and event detail. Replaces both `/events` and `/directory` from the original. |
| [views/LOCATIONS.md](views/LOCATIONS.md) | `/locations/:slug?` | Map explorer with location detail |
| [views/PEOPLE.md](views/PEOPLE.md) | `/people/:slug?` | People list and person detail |
| [views/STATIONS.md](views/STATIONS.md) | `/stations/:slug?` | Stations list and station detail |
| [views/TRANSPORT.md](views/TRANSPORT.md) | `/transport/:slug?` | Transport list and detail |
| [views/OUTLINES.md](views/OUTLINES.md) | `/outlines/:slug?` | Outlines list and detail |
| [views/HOME.md](views/HOME.md) | `/` | Landing page |
| [views/ABOUT.md](views/ABOUT.md) | `/about-us` | About page |

---

## Components

| Document | Component | Description |
|---|---|---|
| [components/CUSTOM-SELECT.md](components/CUSTOM-SELECT.md) | `CustomSelect.vue` | Org/district filter dropdown (single and multi-select) |
| [components/EVENT-PANEL.md](components/EVENT-PANEL.md) | `EventPanel.vue` | Event detail renderer (title, description, gallery, links) |
| [components/TIMELINE-INFO.md](components/TIMELINE-INFO.md) | `TimelineInfo.vue` | Knight Lab Timeline3 wrapper |
| [components/MAP-INFO.md](components/MAP-INFO.md) | `MapInfo.vue` | MapLibre map with clustering and detail panel |
| [components/EVENT-INFO.md](components/EVENT-INFO.md) | `EventInfo.vue` | Original event detail component — reference only |
