# Milorg 2 Utforsker — Project Document

**Status:** Active development  
**Steward:** Benjamin Thomas  
**Content owners:** Jan Warberg & Rolf G. Halvorsen  
**Target org:** `motstandsbevegelsen` (GitHub transfer when stable)

---

## Purpose

Jan Warberg and Rolf G. Halvorsen have spent a decade assembling primary source
research on the Norwegian resistance movement 1940–1945. The data — 2174 events,
3762 people, 1098 locations, 136 stations, 996 transport entries — lives in
Sanity CMS and is largely complete.

This project makes that research navigable in ways a book or a desktop website
cannot: a mobile-first PWA that works offline, a graph layer that connects
people, places, and events across time, and an editorial interface that lets Jan
shape how the material is presented without touching code.

---

## Data sources

| Source | What lives there | Access |
|--------|-----------------|--------|
| **Sanity CMS** (`7r6kqtqy`, dataset `production`) | All primary content — events, people, locations, stations, transport, districts, organisations | Read via CDN + write via API token |
| **Neo4j Aura** | Graph of all entities and relationships, plus extracted content (sections, log entries) | Read via `milorg_reader` user; write via admin during import |
| **IndexedDB** (browser) | Lean cached copies of all entities for instant load and offline use | Local only |

Data flows in one direction: **Sanity → `scripts/neo4j-import-full.ts` → Neo4j**.
The browser reads from both IndexedDB (fast, offline) and Neo4j (enriched graph view).

---

## Current stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3 · TypeScript strict · Vite · vite-plugin-pwa |
| Styling | Plain CSS, custom properties (no UI framework) |
| Map | MapLibre GL JS · CARTO vector tiles |
| Local store | IndexedDB via `idb` |
| CMS | Sanity (hosted) |
| Graph | Neo4j Aura (hosted) |
| Deployment | TBD — see below |

---

## Graph model

All entities are nodes. All references are edges. Content extracted from
Sanity's portable text description fields becomes first-class nodes.

### Node labels

| Label | Identity | Source |
|-------|----------|--------|
| `Event` | `slug` | Sanity event |
| `Person` | `slug` | Sanity person |
| `Location` | `slug` | Sanity location |
| `Station` | `slug` | Sanity station |
| `Transport` | `slug` | Sanity transport |
| `Organization` | `name` | Sanity organisation |
| `District` | `name` | Sanity district |
| `Section` | `id` (`eventSlug::type`) | Extracted from description |
| `LogEntry` | `id` (`eventSlug::log::date::n`) | Extracted from description |

### Key relationships

```
(Event)-[:INVOLVED]->(Person)
(Event)-[:ORIGIN|DESTINATION]->(Location)
(Event)-[:DEPARTED_FROM|ARRIVED_AT]->(Station)
(Event)-[:USED]->(Transport)
(Event)-[:ORGANISED_BY]->(Organization)
(Event)-[:IN_DISTRICT]->(District)
(Event)-[:HAS_SECTION]->(Section)
(Event)-[:HAS_LOG_ENTRY]->(LogEntry)
```

### Section nodes

Each `Section` node carries extracted content from the event description,
typed and ordered by importance:

| `type` | `heading` | `importance` | Description |
|--------|-----------|-------------|-------------|
| `oppdrag` | Oppdrag | 1 | Mission brief — the operation's objectives |
| `personell` | Personell | 2 | Personnel list |
| `deltakere` | Deltakere | 3 | Participants |
| `tidsrommet` | Tidsrommet | 4 | Time period |
| `arbeidsomraade` | Arbeidsområde | 5 | Area of operations |
| `resultat` | Resultat | 6 | Outcome |
| `content` | — | 99 | All remaining description text, markdown-formatted |

### LogEntry nodes

Dated entries extracted from description text. Two types:

| `type` | Pattern | Example |
|--------|---------|---------|
| `report` | `DD/MM-YY  Text...` at line start | ANCC / SOE station monthly log entries |
| `arrest` | `Person Name  DD/M-YY` at line end | Arrest records (Aktion Bärenfang, etc.) |

Both types carry an ISO date, making them queryable by day:

```cypher
// Everything that happened on a given date
CALL {
  MATCH (e:Event) WHERE e.date = $date RETURN e.slug, e.title, e.group, null AS log
  UNION ALL
  MATCH (e:Event)-[:HAS_LOG_ENTRY]->(l:LogEntry {date: $date})
  RETURN e.slug, e.title, e.group, l.text AS log
}
RETURN slug, title, group, log ORDER BY group
```

### Event classification

Every event is classified into a group during the import pipeline
(`scripts/sanity-analyze.ts`) using title prefix matching:

| Group | Prefix examples | Count |
|-------|----------------|-------|
| `AirMission` | AM, AX, CATALINA, BOAC, AVRO | 1074 |
| `SeaPatrol` | MTB, MSP, AU, CONVOY, HMSRN | 257 |
| `NNIUMission` | NNIU | 232 |
| `RadioStation` | SOE/SIS STATION, XU/USSR STATION, WT | 134 |
| `MaritimeCraft` | MK, MÅ, SV, OSELVAR | 127 |
| `StationOperation` | SOE, SIS, SO2, BAR-XU, FROSTFILET | 113 |
| `Narrative` | (all others) | 61 |
| `Meeting` | ANCC, MØTE | 50 |
| `EscapeRoute` | SVERIGE | 38 |
| `Sabotage` | SABOTASJE, TIRPITZ, PLANET | 38 |
| `Training` | KURS, SPESIALKURS | 29 |
| `Raid` | RAZZIA, TELAVÅG | 11 |
| `CommandoRaid` | COHQ | 10 |

---

## UI — Enriched event view

Every event has two tabs:

**Original** — the Sanity content as authored: portable text description,
location links, participant links, transport, gallery, external links.

**Beriket (Enriched)** — the graph view:
- Group badge (colour-coded by event type)
- Named sections (Oppdrag, Personell, etc.) — highest priority, mission brief
  highlighted in navy accent box
- Uncategorised description content (scrollable)
- Dated log entries — each date is a **clickable chip** that opens the Date Panel
  - `report` entries: ANCC / SOE station log (neutral styling)
  - `arrest` entries: red badge "arrestert", person name + date
- Related events via shared people
- Co-located events (same station or location)
- People network (colleagues in other operations)

### Date Panel (modal)

Opens when a log entry date chip is clicked. Shows everything that happened
across the entire resistance network on that day:

```
‹ 29. nov  —  30. nov 1942  —  1. des ›
```

- Field events (operations that started that day)
- Log entries filed that day (from any operation)
- Each row: group badge + event title + log excerpt
- Clicking a row navigates to that event

Prev/next navigation finds the nearest dates with any activity using
`max(d)` / `min(d)` aggregation over both `Event.date` and `LogEntry.date`.

---

## Planned: content block model

The current rendering order is fixed by `importance` values in the import
script. The planned model makes this editorial:

Every piece of connected data (sections, people, log entries, gallery,
links, graph relations) becomes a typed **content block** with an
editor-controlled priority. Jan can open an event and:

1. See all auto-extracted blocks listed in default priority order
2. Reorder them by dragging
3. Add a new block via the **+** button — select type, fill in fields
4. Toggle visibility on any block
5. Override the heading of any block

This turns Jan from a passive data source into an active editor of how
his research is presented.

### Section type registry (planned)

| Type | Fields | Source |
|------|--------|--------|
| `description` | heading, body (markdown) | Editor-authored |
| `people` | — | Graph: `[:INVOLVED]` |
| `logEntries` | — | Graph: `[:HAS_LOG_ENTRY]` |
| `gallery` | — | Sanity: `event.gallery` |
| `links` | — | Sanity: `event.links` |
| `relatedEvents` | — | Graph: shared people |
| `colocated` | — | Graph: shared place |
| `context` | heading, body (markdown) | Editor-authored |

---

## Planned: deployment

### Target platform — Cloudflare

| Service | Purpose | Cost |
|---------|---------|------|
| **Pages** | Hosts the Vite PWA build, global CDN | Free |
| **Workers** | API endpoints — auth, Sanity mutations | Free (100k req/day) |
| **D1** | SQLite database for user/access management | Free |
| **Access** | Google OAuth gate on editor routes | Free (≤50 users) |

### API surface (Workers)

```
GET  /auth/google              → redirect to Google OAuth
GET  /auth/callback            → exchange code, upsert user, set session cookie
GET  /auth/me                  → current session user
POST /auth/logout              → clear session

GET  /api/admin/users          → list all users (admin only)
POST /api/admin/users/:id      → { role: 'editor' | 'denied' } (admin only)

POST   /api/sections           → create Section node
PATCH  /api/sections/:id       → update priority / heading / visibility
DELETE /api/sections/:id       → remove Section node
```

### User roles (D1)

| Role | Can do |
|------|--------|
| `pending` | Has requested access; awaiting approval |
| `editor` | Can add, edit, reorder content blocks on any event |
| `admin` | All of the above + approve / deny / revoke access |
| `denied` | Request denied; shown a message |

First login by an address in `ADMIN_EMAILS` env var gets `admin` automatically.
All other first logins create a `pending` record.

### Access request flow

1. User visits `/access`, clicks **Sign in with Google**
2. Google OAuth callback → user upserted in D1
   - New user → role `pending`, shown "Request submitted — awaiting approval"
   - Pending → shown "Still awaiting approval"
   - Denied → shown "Access not granted"
   - Editor/admin → session cookie set, "+" button appears in app
3. Admin visits `/admin/users`, sees pending requests with **Approve / Deny**
4. Approved user's next page load shows the editor UI

---

## Import pipeline

```
Sanity CMS
  └─ scripts/sanity-export.ts        → data/sanity-*.json  (local snapshots)
  └─ scripts/sanity-analyze.ts       → data/sanity-event-meta.json
       ├─ classify() → event group from title prefix
       ├─ extractSections() → named sections + uncategorised content
       └─ extractLogEntries() → report + arrest log entries

  └─ scripts/neo4j-import-full.ts    → Neo4j Aura
       ├─ Reference nodes (Org, District, Location, Station, Person, Transport)
       ├─ Event nodes + all relationships
       ├─ Section nodes (HAS_SECTION)
       └─ LogEntry nodes (HAS_LOG_ENTRY)

  └─ scripts/sanity-audit.ts         → data/audit-report.json
       ├─ Query graph for structural gaps (no people, no location, etc.)
       ├─ Cross-reference arrest names against Person nodes
       ├─ Flag log entries with dates outside 1939–1946
       ├─ Surface extraction issues from sanity-event-meta.json
       └─ Write structured findings for editor UI
```

Run with Monitor tool (1h timeout — ~20 min for 2174 events):

```bash
npx tsx scripts/neo4j-import-full.ts 2>&1 | grep --line-buffered -E "events$|Done|failed|Error"
```

Requires `.env` with `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` (admin credentials).

---

## Data quality pipeline

The audit script runs after every import and writes `data/audit-report.json` —
a list of structured findings that feed the editor UI's data health dashboard.

### Finding types

| Type | Severity | Query |
|------|----------|-------|
| `no-people` | warning | Events with no `[:INVOLVED]` relationships |
| `no-location` | warning | Events with no location or station relationships |
| `no-date` | error | Events where `e.date IS NULL` |
| `arrest-unmatched` | info | Arrest log entries whose name doesn't match any `Person.name` |
| `date-out-of-range` | error | Log entries with dates outside 1939–1946 |
| `extraction-issue` | info | Issues collected by `sanity-analyze.ts` per event group |
| `missing-section` | info | StationOperation / CommandoRaid events with no `oppdrag` section |
| `no-description` | warning | Events with no `content` section and no named sections |

### Finding shape

```json
{
  "type": "arrest-unmatched",
  "severity": "info",
  "eventSlug": "soe-operation-heron",
  "eventTitle": "SOE Operation ARCHER HERON I - HERON II",
  "message": "Arrest record 'Alfred Påljord' on 1942-05-12 has no matching Person node",
  "data": { "name": "Alfred Påljord", "date": "1942-05-12" }
}
```

### Closing the loop

Jan sees findings in the editor UI, opens the event, adds or corrects data in
Sanity Studio, the next `sanity-export` + `sanity-analyze` + `neo4j-import-full`
run picks up the change, and the next audit run removes the finding.

---

## Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `VITE_SANITY_PROJECT_ID` | Browser | Sanity CDN reads |
| `VITE_SANITY_DATASET` | Browser | Sanity dataset |
| `VITE_NEO4J_URI` | Browser | Neo4j Bolt endpoint |
| `VITE_NEO4J_READER` | Browser | Read-only Neo4j username |
| `VITE_NEO4J_READER_PASSWORD` | Browser | Read-only Neo4j password |
| `NEO4J_URI` | Scripts only | Neo4j Bolt endpoint (admin) |
| `NEO4J_USERNAME` | Scripts only | Neo4j admin username |
| `NEO4J_PASSWORD` | Scripts only | Neo4j admin password |
| `SANITY_API_TOKEN` | Workers (planned) | Sanity write token |
| `ADMIN_EMAILS` | Workers (planned) | Comma-separated bootstrap admin emails |

---

## Key files

| File | Purpose |
|------|---------|
| `src/App.vue` | App shell, startup chain |
| `src/router/index.ts` | All routes |
| `src/pages/EventsView.vue` | Timeline + event list + detail panel |
| `src/components/EventPanel.vue` | Event detail — Original / Beriket tabs |
| `src/components/EnrichedEvent.vue` | Beriket tab — graph queries + log entries |
| `src/components/DatePanel.vue` | Day view modal — everything on a date |
| `src/components/AppModal.vue` | Reusable modal overlay (teleport to body) |
| `src/composables/useNeo4j.ts` | Read-only Neo4j driver (browser) |
| `src/composables/useLocationCache.ts` | IndexedDB ops + background sync |
| `src/composables/useEventsContext.ts` | Events state, filters, hash navigation |
| `src/utils/portableText.ts` | blocksToHtml() + blocksToText() |
| `scripts/sanity-export.ts` | Fetch all Sanity documents → data/*.json |
| `scripts/sanity-analyze.ts` | Classify events, extract sections + log entries |
| `scripts/neo4j-import-full.ts` | Full graph import from local JSON snapshots |

---

## Ownership and transfer

The content belongs to Jan Warberg and Rolf G. Halvorsen. Code stewardship
belongs to Benjamin Thomas. The repository transfers to the
`motstandsbevegelsen` GitHub organisation when stable.

All code decisions should account for future maintainers who did not build
the system. TypeScript strict, clear file structure, and this document exist
for them.
