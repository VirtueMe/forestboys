# Milorg 2 Utforsker

A mobile-first PWA mapping the Norwegian resistance movement 1940–1945.
Built on Jan Warberg and Rolf G. Halvorsen's decade of primary source research.

---

## Stack

Vue 3 · Vite · TypeScript strict · MapLibre GL JS · CARTO tiles · IndexedDB (idb) · vite-plugin-pwa
No UI framework — plain CSS with custom properties.

---

## Data

Sanity CMS project `7r6kqtqy`, dataset `production`.

| Entity    | Count | Notes                       |
| --------- | ----- | --------------------------- |
| locations | 1 095 | 1 invalid coord (Lamholmen) |
| stations  |   136 | airfields, radio stations   |
| people    | 3 758 | no coordinates              |
| events    | 2 163 | sorted by date asc          |

`src/config/sanity.ts` — CDN + image base URLs
`src/types/idb.ts` — IdbLocation, IdbStation, IdbPerson, IdbCache, IdbEventDetail

---

## Key files

- `src/App.vue` — main orchestrator, startup chain, state
- `src/router/index.ts` — all routes; see `docs/ROUTING.md`
- `src/pages/RegistreView.vue` — archive hub: links to People, Transport, Stations, Outlines
- `src/components/AppNav.vue` — top nav, hamburger mobile
- `src/components/AppMap.vue` — MapLibre wrapper
- `src/components/AppDrawer.vue` — sidebar (desktop) / bottom drawer (mobile)
- `src/components/DetailView.vue` — location hero + description + photo strip
- `src/components/EventPanel.vue` — event detail content
- `src/components/ItemCard.vue` — universal card (location / station / person)
- `src/composables/useLocationCache.ts` — all IndexedDB ops + background sync
- `src/composables/useEventsContext.ts` — all /events state, filters, hash navigation
- `src/utils/portableText.ts` — blocksToHtml() + blocksToText(); see docs/PORTABLETEXT.md
- `vite.config.ts` — Sanity proxy + ngrok allowedHosts

---

## Ownership

- **Content**: Jan Warberg & Rolf G. Halvorsen (via Sanity)
- **Stewardship**: Benjamin Thomas (son of initial architect)
- **Repo**: transfer to motstandsbevegelsen GitHub org when ready
