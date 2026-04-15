# Sanity → Neo4j Extraction Pipeline
## Prompt Reference & Usage Guide

> **Purpose**: This document defines all Claude extraction prompts used to transform
> Sanity CMS documents into Neo4j Cypher statements for the Milorg/NMB resistance
> archive graph database. Claude Code should read this file before building or
> extending the pipeline. All prompts are derived from the actual Sanity schema source.

---

## Sanity Schema Map

### Domain documents (graph-relevant)

| Sanity `_type` | UI label | Neo4j node | Prompt |
|---|---|---|---|
| `person` | Person | `Person` | PROMPT-01 |
| `transport` | Transport | `Transport` | PROMPT-02 |
| `event` | Event | `Event` | PROMPT-03 |
| `location` | Location | `Location` | PROMPT-04 |
| `organization` | Organization | `Organization` | PROMPT-05 |
| `district` | **Unit** (not district) | `Unit` | PROMPT-06 |
| `station` | Station | `Station` | PROMPT-07 |

> **Note**: `district` is labelled "Unit" in the Sanity UI and maps to a Milorg
> military unit/cell — not a geographic district. Use `Unit` as the Neo4j label.

### CMS-only documents (skip — no graph extraction)

`outline`, `partner`, `about_us`, `home` — editorial content only, no domain data.

---

## Sanity Field Reference

### person
| Field | Sanity type | Structured/Block | Notes |
|---|---|---|---|
| `name` | string | structured | Primary identifier |
| `slug` | slug | structured | Ignore in Neo4j |
| `secretName` | string | structured | Alias / codename |
| `home` | string | structured | Home town/region |
| `birthYear` | number | structured | |
| `description` | block[] | **block** | Biography — extract to `.biography` |
| `gallery` | image[] | media | Ignore |
| `movie` | file | media | Ignore |
| `links` | object[] | structured | External sources — SET `.links` as JSON array |

### transport
| Field | Sanity type | Structured/Block | Notes |
|---|---|---|---|
| `name` | string | structured | Primary identifier |
| `type` | string | structured | boat / plane / car / etc. |
| `unit` | string | structured | Military unit it belonged to |
| `regser` | string | structured | Registration or serial number |
| `reserve` | string | structured | Reserve/backup designation |
| `description` | block[] | **block** | Extract to `.description` |
| `gallery` | image[] | media | Ignore |
| `movie` | file | media | Ignore |
| `links` | object[] | structured | External sources |

### event
| Field | Sanity type | Structured/Block | Notes |
|---|---|---|---|
| `title` | string | structured | Primary identifier |
| `slug` | slug | structured | Ignore |
| `date` | date | structured | ISO 8601 |
| `organization` | reference → organization | structured ref | Required |
| `district` | reference → district | structured ref | Required — this is the Unit |
| `locationTo` | reference → location | structured ref | Destination location |
| `locationFrom` | reference → location | structured ref | Origin location |
| `stationTo` | reference → station | structured ref | Destination station/base |
| `stationFrom` | reference → station | structured ref | Origin station/base |
| `description` | block[] | **block** | Narrative — roles buried here |
| `people` | reference[] → person | structured ref[] | Flat array — NO roles in schema |
| `transport` | reference[] → transport | structured ref[] | |
| `gallery` | image[] | media | Ignore |
| `movie` | file | media | Ignore |
| `links` | object[] | structured | External sources |

> **Critical**: `event.people` is a flat reference array with no role field.
> Roles (skipper, courier, radio operator, etc.) are only in the `description` blocks.
> The extraction prompt must mine roles from block text and attach them to edges.

### location
| Field | Sanity type | Structured/Block | Notes |
|---|---|---|---|
| `title` | string | structured | Primary identifier |
| `coordinates` | geopoint | structured | `{lat, lng, alt}` → SET `.lat`, `.lng` |
| `description` | block[] | **block** | Extract to `.description` |
| `people` | reference[] → person | structured ref[] | People associated with this location |
| `gallery` | image[] | media | Ignore |
| `links` | object[] | structured | External sources |

### organization
| Field | Sanity type | Structured/Block | Notes |
|---|---|---|---|
| `name` | string | structured | Primary identifier |
| `color` | color | structured | Hex color — SET `.color` (used for UI dots) |

### district (UI: "Unit")
| Field | Sanity type | Structured/Block | Notes |
|---|---|---|---|
| `name` | string | structured | Only field — primary identifier |

### station
| Field | Sanity type | Structured/Block | Notes |
|---|---|---|---|
| `title` | string | structured | Primary identifier |
| `type` | string | structured | Station type classification |
| `coordinates` | geopoint | structured | `{lat, lng}` → SET `.lat`, `.lng` |
| `description` | block[] | **block** | Extract to `.description` |
| `people` | reference[] → person | structured ref[] | People stationed here |
| `gallery` | image[] | media | Ignore |
| `links` | object[] | structured | External sources |

---

## Neo4j Taxonomy

### Node labels

| Label | Source `_type` | Primary key |
|---|---|---|
| `Person` | `person` | `sanityId` |
| `Transport` | `transport` | `sanityId` |
| `Event` | `event` | `sanityId` |
| `Location` | `location` | `sanityId` |
| `Organization` | `organization` | `sanityId` |
| `Unit` | `district` | `sanityId` |
| `Station` | `station` | `sanityId` |
| `Source` | — | `sanityId` + `blockKey` |
| `ExtractionRun` | — | `runId` |

### Edge types

| Edge | From → To | Key properties |
|---|---|---|
| `PARTICIPATED_IN` | Person → Event | `role?` (mined from description blocks) |
| `CREW_OF` | Person → Transport | `role` (mined from description blocks) |
| `PART_OF` | Event → Unit | — |
| `ORGANISED_BY` | Event → Organization | — |
| `DEPARTED_FROM_LOCATION` | Event → Location | — |
| `ARRIVED_AT_LOCATION` | Event → Location | — |
| `DEPARTED_FROM_STATION` | Event → Station | — |
| `ARRIVED_AT_STATION` | Event → Station | — |
| `USED` | Event → Transport | — |
| `ASSOCIATED_WITH` | Location → Person | — |
| `STATIONED_AT` | Person → Station | — |
| `MEMBER_OF` | Person → Unit | `from?`, `to?` |
| `EXTRACTED_FROM` | any → Source | `confidence?` |
| `PART_OF_RUN` | Source → ExtractionRun | — |

---

## Universal Rules (apply to ALL prompts)

1. Output **only valid Cypher MERGE statements** — no prose, no explanation, no markdown fences
2. Use **MERGE not CREATE** — all queries must be idempotent
3. Use `sanityId` as the primary identifier on all nodes
4. Resolve Sanity `_ref` values: the `_ref` string IS the `sanityId` of the target node —
   MERGE the target node by `sanityId` only, do not invent other properties
5. **Role extraction from blocks**: `event.people` has no role field — extract roles from
   `description` block text and attach as properties on `PARTICIPATED_IN` edges.
   If no role found, emit the edge without a role property.
6. Descriptive text placement:
   - About the node's nature → `SET` as `.description` or `.biography` on the node
   - About a relationship → property on that edge
   - Something that happened → `(:Event)` node (only if not already the document itself)
   - Ambiguous → attach to `(:Source)` as `.rawText` and add `// REVIEW: <reason>`
7. Flag uncertain extractions with `// UNCERTAIN: <reason>`
8. Every extracted node gets `[:EXTRACTED_FROM]->(src)`
9. Dates use ISO 8601: `YYYY-MM-DD`. Use `null` if unknown.
10. Ignore: `slug`, `gallery`, `movie` fields — media only, no graph value

---

## Prompts

---

### PROMPT-01 — person

**Trigger**: `doc._type === "person"`

**Structured fields** (direct mapping): `name`, `secretName`, `home`, `birthYear`, `links`

**Block fields** (Claude extraction): `description` → biography text + any mentioned
relationships, memberships, events

**Prompt**:
```
You are extracting structured graph data from a Norwegian WWII resistance
archive document (Milorg / NMB).

Document type: person
Document JSON:
{DOCUMENT_JSON}

STRUCTURED FIELDS — map these directly:
  name         → Person.name (required)
  secretName   → Person.secretName (if present)
  home         → Person.home (if present)
  birthYear    → Person.birthYear (if present)
  links        → Person.links as JSON string (if present)

BLOCK FIELDS — extract from description[]:
  Biography text → SET p.biography
  Any mentioned Unit/cell memberships → [:MEMBER_OF {from?, to?}]->(u:Unit {sanityId: ref})
  Any mentioned events → [:PARTICIPATED_IN {role?}]->(e:Event {sanityId: ref})
  Any mentioned person contacts → [:CONTACT_WITH {context?}]->(p2:Person)
  Roles mentioned → attach as property on the relevant edge

NODE TAXONOMY:
  (:Person) (:Transport) (:Event) (:Location)
  (:Organization) (:Unit) (:Station) (:Source)

RULES:
1. Output ONLY valid Cypher MERGE statements. No prose, no markdown.
2. Use MERGE not CREATE — idempotent.
3. _ref values are sanityIds — MERGE target nodes by sanityId only.
4. Flag uncertain extractions: // UNCERTAIN: <reason>
5. Ambiguous text → Source.rawText + // REVIEW: <reason>
6. Every node gets [:EXTRACTED_FROM]->(src).
7. Ignore: slug, gallery, movie.

PROVENANCE — always include:
  MERGE (src:Source {sanityId: "{DOCUMENT_ID}", blockKey: "{BLOCK_KEY}"})
  SET src.extractedAt = datetime()
```

**Example output**:
```cypher
MERGE (src:Source {sanityId: "person-abc123", blockKey: "root"})
SET src.extractedAt = datetime()

MERGE (p:Person {sanityId: "person-abc123"})
SET p.name = "Leif Larsen",
    p.secretName = "Shetlands-Larsen",
    p.home = "Leksvik",
    p.birthYear = 1906,
    p.biography = "Decorated naval officer who completed more than 50 Shetland Bus crossings..."

MERGE (p)-[:EXTRACTED_FROM]->(src)
```

---

### PROMPT-02 — transport

**Trigger**: `doc._type === "transport"`

**Structured fields**: `name`, `type`, `unit`, `regser`, `reserve`, `links`

**Block fields**: `description` → operational history, crew mentions, crossing details

**Prompt**:
```
You are extracting structured graph data from a Norwegian WWII resistance
archive document (Milorg / NMB).

Document type: transport
Document JSON:
{DOCUMENT_JSON}

STRUCTURED FIELDS — map these directly:
  name    → Transport.name (required)
  type    → Transport.type (boat / plane / car / etc.)
  unit    → Transport.unit (military unit string)
  regser  → Transport.regser (registration or serial number)
  reserve → Transport.reserve

BLOCK FIELDS — extract from description[]:
  General description → SET t.description
  Crew members mentioned with roles → [:CREW_OF {role: "skipper|navigator|..."}]
  Events/crossings mentioned → note as // REVIEW (event docs handle USED edges)
  Locations mentioned → note as // REVIEW (event docs handle location edges)

NODE TAXONOMY:
  (:Person) (:Transport) (:Event) (:Location)
  (:Organization) (:Unit) (:Station) (:Source)

RULES:
1. Output ONLY valid Cypher MERGE statements. No prose, no markdown.
2. Use MERGE not CREATE — idempotent.
3. Crew roles go on the [:CREW_OF] edge, not on the Person node.
4. If same person held multiple roles, emit one edge per role.
5. _ref values are sanityIds — MERGE target nodes by sanityId only.
6. Flag uncertain extractions: // UNCERTAIN: <reason>
7. Ambiguous text → Source.rawText + // REVIEW: <reason>
8. Every node gets [:EXTRACTED_FROM]->(src).
9. Ignore: slug, gallery, movie.

PROVENANCE — always include:
  MERGE (src:Source {sanityId: "{DOCUMENT_ID}", blockKey: "{BLOCK_KEY}"})
  SET src.extractedAt = datetime()
```

---

### PROMPT-03 — event

**Trigger**: `doc._type === "event"`

**Structured fields** (direct mapping — all references are sanityIds):
`title`, `date`, `organization._ref`, `district._ref`, `locationTo._ref`,
`locationFrom._ref`, `stationTo._ref`, `stationFrom._ref`,
`people[*]._ref`, `transport[*]._ref`

**Block fields**: `description` → narrative, **roles of people** (not in schema),
operational details

> **This is the most important document type.** It links all other entities.
> Roles for `people` references are ONLY in the description blocks — always mine them.

**Prompt**:
```
You are extracting structured graph data from a Norwegian WWII resistance
archive document (Milorg / NMB).

Document type: event
Document JSON:
{DOCUMENT_JSON}

STRUCTURED FIELDS — map these directly as MERGE statements:
  title              → Event.title (required)
  date               → Event.date (ISO 8601)
  organization._ref  → [:ORGANISED_BY]->(org:Organization {sanityId: _ref})
  district._ref      → [:PART_OF]->(u:Unit {sanityId: _ref})
  locationFrom._ref  → [:DEPARTED_FROM_LOCATION]->(l:Location {sanityId: _ref})
  locationTo._ref    → [:ARRIVED_AT_LOCATION]->(l:Location {sanityId: _ref})
  stationFrom._ref   → [:DEPARTED_FROM_STATION]->(s:Station {sanityId: _ref})
  stationTo._ref     → [:ARRIVED_AT_STATION]->(s:Station {sanityId: _ref})
  people[*]._ref     → [:PARTICIPATED_IN] from each Person {sanityId: _ref}
                        !! roles are NOT in the schema — mine from description blocks
  transport[*]._ref  → [:USED]->(t:Transport {sanityId: _ref})

BLOCK FIELDS — extract from description[]:
  Event narrative → SET e.description
  Person roles    → add role property to the relevant [:PARTICIPATED_IN] edge
                    match person by name or context to their _ref entry
  Additional people not in people[] → emit [:PARTICIPATED_IN {role?}]
  Additional transport not in transport[] → emit [:USED]
  Sub-events (arrests, weather delays, damage) → (:Event) child linked with [:RESULTED_IN]

NODE TAXONOMY:
  (:Person) (:Transport) (:Event) (:Location)
  (:Organization) (:Unit) (:Station) (:Source)

RULES:
1. Output ONLY valid Cypher MERGE statements. No prose, no markdown.
2. Use MERGE not CREATE — idempotent.
3. _ref values ARE the sanityIds — always MERGE by sanityId.
4. ALWAYS attempt to extract roles from description blocks for every person in people[].
5. If no role found for a person, emit [:PARTICIPATED_IN] without role property.
6. Flag uncertain role extractions: // UNCERTAIN: role inferred from context
7. Ambiguous text → Source.rawText + // REVIEW: <reason>
8. Every node gets [:EXTRACTED_FROM]->(src).
9. Ignore: slug, gallery, movie, links.

PROVENANCE — always include:
  MERGE (src:Source {sanityId: "{DOCUMENT_ID}", blockKey: "{BLOCK_KEY}"})
  SET src.extractedAt = datetime()
```

**Example output**:
```cypher
MERGE (src:Source {sanityId: "event-xyz789", blockKey: "root"})
SET src.extractedAt = datetime()

MERGE (e:Event {sanityId: "event-xyz789"})
SET e.title = "Shetland Bus crossing March 1943",
    e.date = "1943-03-14",
    e.description = "Night crossing from Shetland to Møre og Romsdal carrying radio equipment..."

MERGE (org:Organization {sanityId: "org-milorg"})
MERGE (e)-[:ORGANISED_BY]->(org)

MERGE (u:Unit {sanityId: "unit-d13"})
MERGE (e)-[:PART_OF]->(u)

MERGE (lFrom:Location {sanityId: "loc-lerwick"})
MERGE (e)-[:DEPARTED_FROM_LOCATION]->(lFrom)

MERGE (lTo:Location {sanityId: "loc-aalesund"})
MERGE (e)-[:ARRIVED_AT_LOCATION]->(lTo)

MERGE (t:Transport {sanityId: "transport-bergholm"})
MERGE (e)-[:USED]->(t)

MERGE (p1:Person {sanityId: "person-leif-larsen"})
MERGE (p1)-[:PARTICIPATED_IN {role: "skipper"}]->(e)

MERGE (p2:Person {sanityId: "person-johan-pettersen"})
MERGE (p2)-[:PARTICIPATED_IN]->(e)
// UNCERTAIN: role not found in description blocks

MERGE (e)-[:EXTRACTED_FROM]->(src)
MERGE (p1)-[:EXTRACTED_FROM]->(src)
MERGE (p2)-[:EXTRACTED_FROM]->(src)
MERGE (t)-[:EXTRACTED_FROM]->(src)
```

---

### PROMPT-04 — location

**Trigger**: `doc._type === "location"`

**Structured fields**: `title`, `coordinates.lat`, `coordinates.lng`, `people[*]._ref`

**Block fields**: `description` → location history, usage context

**Prompt**:
```
You are extracting structured graph data from a Norwegian WWII resistance
archive document (Milorg / NMB).

Document type: location
Document JSON:
{DOCUMENT_JSON}

STRUCTURED FIELDS — map these directly:
  title              → Location.title (required)
  coordinates.lat    → Location.lat
  coordinates.lng    → Location.lng
  people[*]._ref     → [:ASSOCIATED_WITH]->(p:Person {sanityId: _ref})

BLOCK FIELDS — extract from description[]:
  Location description/history → SET l.description
  Usage context (safe house, depot, landing site, etc.) → SET l.locationType
  Events that occurred here → note as // REVIEW (event docs are authoritative)

NODE TAXONOMY:
  (:Person) (:Transport) (:Event) (:Location)
  (:Organization) (:Unit) (:Station) (:Source)

RULES:
1. Output ONLY valid Cypher MERGE statements. No prose, no markdown.
2. Use MERGE not CREATE — idempotent.
3. _ref values are sanityIds.
4. Flag uncertain extractions: // UNCERTAIN: <reason>
5. Ambiguous text → Source.rawText + // REVIEW: <reason>
6. Every node gets [:EXTRACTED_FROM]->(src).
7. Ignore: slug, gallery, movie, links.

PROVENANCE — always include:
  MERGE (src:Source {sanityId: "{DOCUMENT_ID}", blockKey: "{BLOCK_KEY}"})
  SET src.extractedAt = datetime()
```

---

### PROMPT-05 — organization

**Trigger**: `doc._type === "organization"`

**Structured fields only** — no block content in this schema.

**Prompt**:
```
You are extracting structured graph data from a Norwegian WWII resistance
archive document (Milorg / NMB).

Document type: organization
Document JSON:
{DOCUMENT_JSON}

STRUCTURED FIELDS — map these directly:
  name   → Organization.name (required)
  color  → Organization.color (hex string, used for UI color coding)

RULES:
1. Output ONLY valid Cypher MERGE statements. No prose, no markdown.
2. Use MERGE not CREATE — idempotent.
3. This document type has no block content — structured mapping only.
4. Every node gets [:EXTRACTED_FROM]->(src).

PROVENANCE — always include:
  MERGE (src:Source {sanityId: "{DOCUMENT_ID}", blockKey: "{BLOCK_KEY}"})
  SET src.extractedAt = datetime()
```

**Example output**:
```cypher
MERGE (src:Source {sanityId: "org-milorg", blockKey: "root"})
SET src.extractedAt = datetime()

MERGE (o:Organization {sanityId: "org-milorg"})
SET o.name = "Milorg", o.color = "#1a3a6b"

MERGE (o)-[:EXTRACTED_FROM]->(src)
```

---

### PROMPT-06 — district (Unit)

**Trigger**: `doc._type === "district"`

**Note**: This Sanity type is labelled "Unit" in the UI. It represents a Milorg
military unit/cell — not a geographic district. Use `Unit` as the Neo4j label.

**Structured fields only** — `name` is the only field.

**Prompt**:
```
You are extracting structured graph data from a Norwegian WWII resistance
archive document (Milorg / NMB).

Document type: district (represents a Milorg military Unit)
Document JSON:
{DOCUMENT_JSON}

STRUCTURED FIELDS — map these directly:
  name → Unit.name (required)

RULES:
1. Output ONLY valid Cypher MERGE statements. No prose, no markdown.
2. Use MERGE not CREATE — idempotent.
3. Use node label (:Unit) not (:District).
4. This document type has no block content — structured mapping only.
5. Every node gets [:EXTRACTED_FROM]->(src).

PROVENANCE — always include:
  MERGE (src:Source {sanityId: "{DOCUMENT_ID}", blockKey: "{BLOCK_KEY}"})
  SET src.extractedAt = datetime()
```

---

### PROMPT-07 — station

**Trigger**: `doc._type === "station"`

**Structured fields**: `title`, `type`, `coordinates.lat`, `coordinates.lng`, `people[*]._ref`

**Block fields**: `description` → station history, operational context

**Prompt**:
```
You are extracting structured graph data from a Norwegian WWII resistance
archive document (Milorg / NMB).

Document type: station
Document JSON:
{DOCUMENT_JSON}

STRUCTURED FIELDS — map these directly:
  title              → Station.title (required)
  type               → Station.type (station classification)
  coordinates.lat    → Station.lat
  coordinates.lng    → Station.lng
  people[*]._ref     → emit [:STATIONED_AT]->(s) from Person {sanityId: _ref}
                        (invert: person was stationed AT this station)

BLOCK FIELDS — extract from description[]:
  Station description/history → SET s.description
  Operational periods → SET s.activeFrom, s.activeTo if dates clearly stated
  Events at this station → note as // REVIEW (event docs are authoritative)

NODE TAXONOMY:
  (:Person) (:Transport) (:Event) (:Location)
  (:Organization) (:Unit) (:Station) (:Source)

RULES:
1. Output ONLY valid Cypher MERGE statements. No prose, no markdown.
2. Use MERGE not CREATE — idempotent.
3. _ref values are sanityIds.
4. Invert people[] relationship: Person-[:STATIONED_AT]->Station
5. Flag uncertain extractions: // UNCERTAIN: <reason>
6. Ambiguous text → Source.rawText + // REVIEW: <reason>
7. Every node gets [:EXTRACTED_FROM]->(src).
8. Ignore: slug, gallery, movie, links.

PROVENANCE — always include:
  MERGE (src:Source {sanityId: "{DOCUMENT_ID}", blockKey: "{BLOCK_KEY}"})
  SET src.extractedAt = datetime()
```

---

## Pipeline Architecture

### Prompt selector

```javascript
const PROMPTS = {
  person:       PROMPT_01,
  transport:    PROMPT_02,
  event:        PROMPT_03,
  location:     PROMPT_04,
  organization: PROMPT_05,
  district:     PROMPT_06,
  station:      PROMPT_07,
}

// Skip CMS-only types
const SKIP_TYPES = new Set(['outline', 'partner', 'aboutUs', 'home'])

function selectPrompt(doc) {
  if (SKIP_TYPES.has(doc._type)) return null
  return PROMPTS[doc._type] ?? null // null = log and skip unknown types
}
```

### Input preparation

```javascript
function preparePayload(doc) {
  return {
    DOCUMENT_JSON:  JSON.stringify(doc, null, 2),
    DOCUMENT_ID:    doc._id,
    BLOCK_KEY:      'root',
    BLOCK_RAW_TEXT: extractPlainText(doc) // strip portable text to plain string
  }
}
```

### Recommended processing order

Process in this order so referenced nodes exist before edges are created:

1. `organization` — no dependencies
2. `district` (Unit) — no dependencies
3. `location` — no dependencies
4. `station` — no dependencies
5. `person` — no dependencies
6. `transport` — may reference person (crew in blocks)
7. `event` — references all of the above

### Extraction run logging

```cypher
MERGE (run:ExtractionRun {id: "{RUN_ID}"})
SET run.timestamp  = datetime(),
    run.model      = "claude-sonnet-4-20250514",
    run.promptVer  = "1.1.0",
    run.totalDocs  = {COUNT}

MERGE (src:Source {sanityId: "{DOC_ID}", blockKey: "root"})
MERGE (src)-[:PART_OF_RUN]->(run)
```

### Review queue queries

```cypher
// All nodes needing human review
MATCH (src:Source)
WHERE src.rawText CONTAINS 'REVIEW'
RETURN src.sanityId, src.rawText
ORDER BY src.extractedAt

// All uncertain extractions
MATCH (src:Source)
WHERE src.rawText CONTAINS 'UNCERTAIN'
RETURN src.sanityId, src.rawText

// People on events with no role resolved
MATCH (p:Person)-[r:PARTICIPATED_IN]->(e:Event)
WHERE r.role IS NULL
RETURN p.name, e.title, e.date
ORDER BY e.date

// Duplicate Person candidates
MATCH (p1:Person), (p2:Person)
WHERE p1.name = p2.name AND id(p1) < id(p2)
RETURN p1.name, p1.sanityId, p2.sanityId
```

---

## Confidence & Quality Tags

| Comment tag | Meaning | Action |
|---|---|---|
| `// UNCERTAIN: <reason>` | Extraction inferred, not explicit | Jan/Rolf verify |
| `// REVIEW: <reason>` | Could not classify text | Jan/Rolf assign manually |
| no comment | High-confidence extraction | Auto-accept |

---

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-04-15 | Initial taxonomy (guessed schema) |
| 1.1.0 | 2026-04-15 | Rewritten from actual Sanity schema source — added Station, Unit, corrected event structure, added role-mining for event.people[], added transport fields unit/regser/reserve |

---

> **Maintainer**: Benny (BANCS AS)
> **Domain experts**: Jan, Rolf
> **Co-developer**: Benjamin
> **Original Sanity developer**: Artem
