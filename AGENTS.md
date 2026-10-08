# Milorg 2 Utforsker

A mobile-first PWA mapping the Norwegian resistance movement 1940–1945.
Built on Jan Warberg and Rolf G. Halvorsen's decade of primary source research.

The public site reads a Neo4j graph. Editing and adding content the ordinary way, with
the editors on the entity pages, is the main focus of the site. On the side there is an
AI-assisted path: a bot proposes edits to entities as bundles, and an admin reviews and
accepts them. Sanity (the earlier CMS) is still read by the browser for some cached
lists and is synced into the graph daily until cutover.

Start at `docs/INDEX.md` for every design and architecture document. This file is the
short map; the docs hold the detail.

---

## Stack

- **App**: Vue 3 · Vite · TypeScript strict · MapLibre GL JS · CARTO tiles · IndexedDB (idb) · vite-plugin-pwa. No UI framework: plain CSS with custom properties.
- **Server**: Cloudflare Pages Functions (`functions/`) hold every credential. The browser never talks to the database directly.
- **Graph**: Neo4j (Aura in production, `docker-compose.yml` locally) is the source of truth for content.
- **D1** `milorg_users`: users, roles, site settings (`migrations/`).
- **R2**: `IMAGES` (photos), `PROPOSALS` (review bundles).
- **Durable Object** `BundleEventsDO`: live updates when a bundle arrives. It lives in its own worker, `workers/bundle-events`, deployed with `npm run deploy:do`.
- **Auth**: GitHub and Google OAuth, session cookie (`functions/auth/`); roles in `docs/ROLES.md`.

`wrangler.toml` is the source of truth for Pages bindings and plain variables; secrets
live in the Cloudflare dashboard only. The rules that have cost time are in
`docs/CLOUDFLARE.md`. A name defined both in `wrangler.toml` and in the dashboard fails
the deployment.

---

## Design

Visual identity is specified in `DESIGN.md` (light) and `DESIGN-dark.md` (dark).
Follow both files when building any UI: tokens, typography, component patterns,
and anti-patterns. The aesthetic is **Archival Paper**: warm paper tones, serif
body + sans UI, a single restrained red accent. When a component is ambiguous,
the anti-patterns list is load-bearing.

The component pairs in those files meet WCAG AA, and `npm test` checks it. A redesign
must keep it.

---

## Data

The graph model is `docs/SCHEMA.md`; how Sanity maps onto it is `docs/NEO4J-MAPPING.md`.
Entities: people, organizations, units, locations, stations, transport, equipment,
events (operations, incidents), outlines, sources, with descriptions as portable text
(`HAS_CONTENT`) and source citations as `SourceRef` strings.

- **Read path**: the browser calls `POST /api/neo4j/query` through `src/composables/useNeo4j.ts`. It runs in a read transaction, so Neo4j refuses any write.
- **Write path**: editors use `/api/admin/*` (one folder per entity kind), which write to the graph directly. This is the main way content changes.
- **AI-assisted proposals**: the proposal bot (`scripts/bot/`, `scripts/prompts/`) sends bundles of entity edits through `/api/proposals/*`; an admin reviews them and the accepted ones are applied to the graph (`functions/api/admin/proposals`, `docs/PROPOSALS.md`, `docs/BUNDLE-FORMAT.md`).
- **Sanity**: `src/config/sanity.ts` and `useLocationCache.ts` still read the Sanity CDN for the cached location/station lists. `scripts/sync/` copies Sanity changes into the graph (`docs/SANITY-SYNC.md`; CI runs it daily in `.github/workflows/sanity-sync.yml`). Sanity project `7r6kqtqy`, dataset `production`.
- **Cache**: `src/types/idb.ts` defines the IndexedDB shapes; `useLocationCache.ts` owns the IndexedDB ops and background sync.

---

## Architecture map

| Path | What |
| --- | --- |
| `src/App.vue` | Start here: the shell, startup chain and state. |
| `src/pages/` | One view per route. Public: `MapView`, `EventsView`, `PeopleView`, `RegistreView` and the `*Detail` pages, which every one has an edit mode for signed-in editors. Admin: `Admin*`. Proposal review: `AdminProposal*`. `ReviewView` (`/admin/review`) is a different, older review: unresolved matches and missing persons from data imports. |
| `src/composables/` | `use*Data` read the graph per entity; `useProposal*` do the same for a proposed bundle; `useEventsContext` holds all `/events` state; `useAuth`, `useRoles`. |
| `src/components/` | `AppNav`, `AppMap`, `AppDrawer`, `DetailView`, `EventPanel`, `ItemCard` (universal card). |
| `src/utils/portableText.ts` | `blocksToHtml()` and `blocksToText()`; see `docs/PORTABLETEXT.md`. |
| `src/router/index.ts` | All routes; see `docs/ROUTING.md`. |
| `functions/api/` | `neo4j` (read), `admin` (writes, per entity kind), `proposals` (ingest, request, events), `entity`, `site-settings`. |
| `functions/auth/` | OAuth callbacks, session, `me`. |
| `functions/_lib/` | Shared server code: sessions, role scopes, bundle package/validate/origin, heading and link guards. |
| `workers/bundle-events/` | The Durable Object worker. |
| `migrations/` | D1 SQL migrations. Graph migrations are in `scripts/migrations/`. |
| `scripts/` | Sync, bundles, seed, e2e recording, local helpers; see `scripts/README.md`. |
| `e2e/` | Playwright: editor, design checks, page replay from `e2e/fixtures`. |
| `docs/` | Design and architecture documents; `docs/views/` has one file per view. |

---

## Commands

`CONTRIBUTING.md` has install, lint, test and build (`npm run build` is the type-check, including `functions/`; do not use a bare `tsc`). The ones that are easy to miss:

```bash
npm run dev:worker    # SPA + Pages Functions, :8788 (needs .dev.vars, see README)
npm run dev:do        # the bundle-events worker locally, :8790
npm run test:neo4j    # opt-in, against a real local Neo4j
npm run test:e2e      # Playwright
npm run e2e:record    # re-record page fixtures (dry run unless --write)
npm run check:design  # DESIGN*.md lint + AA contrast of every component pair
npm run pull:graph    # copy production's graph into the local one (dry run unless --write)
npm run pull:bundles  # same for the PROPOSALS bucket
```

---

## Working rules

- Branch from `main`, named `<type>/<issue>_<slug>`. Commit with Conventional Commits; the type drives the version bump and changelog (`CONTRIBUTING.md`).
- `main` is protected: changes land through pull requests with the `Lint, type-check, build` and `Cloudflare Pages` checks green. Never push to `main`. Do not edit `CHANGELOG.md` or the version by hand.
- Scripts that can write are a **dry run unless `--write`**. They talk to the local Neo4j unless you pass `--production`; production writes need an explicit go-ahead each time (`scripts/README.md`).
- Test Cypher against the real local Neo4j (`npm run test:neo4j`); mocks alone miss invalid Cypher.
- e2e runs on Linux in CI, and a pass on macOS is not a CI pass. Browser-level gestures can behave differently.
- Never commit `.dev.vars`, `.env`, `.env.production` or any credential.
- Match the surrounding code's naming and comment density.

---

## Ownership

- **Content**: Jan Warberg & Rolf G. Halvorsen (via Sanity, and now the graph)
- **Repo**: transfer to the motstandsbevegelsen GitHub org when ready (#26)
