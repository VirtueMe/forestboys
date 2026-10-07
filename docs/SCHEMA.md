# Neo4j Graph Schema

Pure data spec — node labels, properties, edges, controlled vocabularies, and rules. Use this when authoring a Cypher migration round, validating an import, or planning a Sanity → Neo4j mapping.

For the Sanity-document → Neo4j-node mapping table see `NEO4J-MAPPING.md`.
For the long-term architecture rationale see `DB.md`.
For the proposal-flow that uses Outline nodes to drive Claude-generated edits see `PROPOSALS.md`.

This document defines the graph. It deliberately says nothing about how it's queried, edited, or rendered.

---

## Identity & naming

| Property        | Meaning                                                                                  |
|-----------------|------------------------------------------------------------------------------------------|
| `slug`          | URL-safe identifier. Unique within a label. The MATCH key for all reads.                 |
| `canonicalName` | Display name. Required on every first-citizen node.                                      |
| `sanityId`      | Original Sanity document `_id`. Kept for traceability + as MERGE target during migrations.|
| `name` / `title` | **Legacy** display fields from the Sanity import. Until the slug+canonicalName backfill completes, MATCH on `coalesce(canonicalName, title|name)`. |

**Rules:**

- `slug` MUST match `/^[a-z0-9-]+$/`.
- The literal `new` is reserved as a slug — used by the in-page create form.
- `slug` uniqueness is scoped to the label (a `Person {slug:"x"}` and a `Unit {slug:"x"}` may coexist, but two `Person {slug:"x"}` may not).
- Migration rounds MERGE on `sanityId`; reads MATCH on `slug`.

---

## Cross-cutting conventions

### Description model — `HAS_CONTENT`

All entity descriptions use the same shape:

```
(entity)-[:HAS_CONTENT {order}]->(d:Description {id, order, content})
```

- `content` is a JSON-stringified Portable Text block array.
- `id` MUST be `desc:<kind>:<slug>:<order>` (e.g. `desc:unit:linge:1`).
- `order` is 1-based.

Per-section citations:

```
(d)-[:CITES {inline: bool}]->(s:Source)        // inline footnote markers
(d)-[:SOURCED_FROM]->(s:Source)                // "based on" attribution for the section
```

**Rule:** never store rich text in a node or edge property like `r.description` outside of a `Description` node. Short scalar edge metadata (role, order, dates, flags) stays on the edge; any rich text MUST live on a `Description`.

**Rule:** per-Description `recordedDate` / `author` / multi-voice attribution is **not** part of the spec. Don't add it without an explicit decision.

### Legacy `ABOUT` description model (deprecated)

The Sanity-outline-migration produced:

```
(d:Description {recordedDate, author, content})-[:ABOUT]->(:Unit)
```

These exist only on `Unit` nodes. Migration target: convert each to `(:Unit)-[:HAS_CONTENT]->(:Description)`.

### Source citations — `SourceRef` strings

Two ways to attach sources:

1. **First-class edges** (`CITES`, `SOURCED_FROM`, `REFERENCED_IN`, `EXTRACTED_FROM`, `FROM`) — preferred for all new content.
2. **`sourceRef` strings** stored in node properties or edge `sourceRefs[]` arrays.

`sourceRef` string format:

```
<source-id>[#<kind>:<entry>[,<entry>]*]
```

- `<source-id>` — Source node `id`, Sanity snapshot path, or synthetic ID (`sanity-migration`, `default:menig-soldier-baseline`).
- `<kind>` ∈ `page | line | chars | block | time` (extensible).
- `<entry>` — point (`47`) or range (`47..52`); commas separate disjoint entries.
- Fragment is optional — bare `<source-id>` means "the source as a whole."

Examples:
- `urn-nbn-2010091308034#page:47,89,120..130`
- `youtube:VBXZl0Pr3rw#time:02:34..03:15`
- `archive:HS7-182#page:49..51`
- `default:menig-soldier-baseline` — synthetic, unsourced default
- `editorial:jan-warberg:2026-04-19` — synthetic editorial decision

**Parse rule:** split on `#`, then on `:`, then on `,`, then on `..`. Backward-compatible with bare `<source-id>` refs.

### `HAS_IMAGE` + photo metadata

```
(entity)-[:HAS_IMAGE {order, caption, scope, isHero}]->(s:Source {kind, ...})
```

Edge properties:

| Prop      | Type     | Meaning                                                                                |
|-----------|----------|----------------------------------------------------------------------------------------|
| `order`   | int      | Gallery position on this attachment.                                                   |
| `caption` | string   | Per-attachment caption (same Source can have different captions on different entities).|
| `scope`   | enum     | `'entity'` pins to this attachment only (do not propagate). Absent ⇒ propagate.        |
| `isHero`  | bool     | At most one `true` per entity (UI convention, not graph-enforced).                     |

`Source.kind` controlled vocabulary (when `Source.type = 'photograph'`):

`portrait | group | action | scene | document | artifact | uniform | landscape`

**Propagation rule:** when a query traverses `HAS_IMAGE` from one entity through another (e.g. an Org's gallery aggregating photos from its Units), every propagating hop MUST exclude `WHERE coalesce(h.scope, 'propagate') <> 'entity'`. Direct (own) hops MUST NOT apply this filter.

### Hierarchical filter rule

For node types with `PART_OF` hierarchies (Unit, Organization, VesselClass):

- A *top-level* node has no outbound `PART_OF` to its own label.
  - Top-level Unit: `WHERE NOT (u:Unit)-[:PART_OF]->(:Unit)`
  - Top-level Organization: `WHERE NOT (o:Organization)-[:PART_OF]->(:Organization)`
- *"All descendants of"* queries traverse `PART_OF*0..`:
  - `MATCH (p:Person)-[:MEMBER_OF]->(:Unit)-[:PART_OF*0..]->(u:Unit {slug: $slug})`

Event hierarchy (Incident/Operation) uses `RELATED_TO {kind:'contains'}` instead — same containment semantics, opposite direction (parent → child), traversal pattern is `(:Operation {slug:$slug})-[:RELATED_TO {kind:'contains'}*0..]->(:Incident|Operation)`.

### Aggregation by query, not duplication

When an entity has parts (Operation → sub-Operations, Organization → sub-Units), derived properties (all locations used, all people involved, full timeline, all sources) MUST be computed by graph traversal at read time. **Never copy child data onto the parent.**

### Sort convention for annotated edges

Edges that carry `description` (info-marker tooltip text) or non-empty `sourceRefs[]` are *annotated* — they sort **last** in any ordered traversal:

```cypher
ORDER BY CASE WHEN r.description IS NOT NULL THEN 1 ELSE 0 END,
         coalesce(r.order, 999), name
```

### Crew-role validation

Whether a `CREW_OF.role` is legal on a given Transport is a single hierarchical traversal — same shape as the Unit hierarchical filter rule:

```cypher
MATCH (t:Transport {slug: $tSlug})-[:OF_CLASS]->(tc:VesselClass)
MATCH (r:CrewRole {slug: $rSlug})-[:APPLIES_TO_CLASS]->(rc:VesselClass)
MATCH (tc)-[:PART_OF*0..]->(rc)
RETURN count(*) > 0 AS legal
```

Inheritance is automatic: `pilot APPLIES_TO_CLASS aircraft` covers every aircraft subclass without enumerating; `flight-engineer APPLIES_TO_CLASS heavy-bomber` stays narrow; `skipper APPLIES_TO_CLASS vessel` covers all watercraft.

The admin editor MUST run this check before writing a `CREW_OF` edge — invalid combinations are rejected, not stored and flagged.

### Provenance + revert stamps (Sanity-sourced data)

Every Sanity-imported node carries lineage so the proposal generator can
distinguish "untouched import" from "Jan edited this locally":

| Property            | Type   | Meaning                                                      |
|---------------------|--------|--------------------------------------------------------------|
| `sanityId`          | string | Sanity document `_id`. (Also documented in identity table.)  |
| `sanityRev`         | string | Sanity's `_rev` at import time. Cheap upstream-change check. |
| `sanityImportedAt`  | string | ISO timestamp of the import.                                 |
| `sanitySha`         | string | sha256 of the imported value (stable-key-ordered JSON).      |

For PT-block-bearing nodes (`Description` in v1 scope) every block also
carries one-step revert state:

| Property         | Type   | Meaning                                                                |
|------------------|--------|------------------------------------------------------------------------|
| `previousValue`  | string | Stringified prior PT block JSON. Null when the block has never been overwritten. |
| `previousSha`    | string | sha256 of `previousValue`.                                             |
| `previousAt`     | string | ISO timestamp of the prior write.                                      |
| `previousSource` | string | `'sanity-import' | 'proposal:<ts>' | 'manual-edit'`                    |

| `previousKind`   | string | What `previousValue` holds: `'block'` (the one block a `modify-block` replaced) or `'description'` (the whole content a `set-description` replaced). Absent on writes from before it existed: those hold a block. |

Revert = swap `previousValue` back in (a block into its place, or the whole content, by `previousKind`), then clear
the `previous*` fields (one step back is the contract). See `PROPOSALS.md` for the full
proposal-flow design and the durable history log.

### Origin stamps (what an accepted bundle created)

Written by the accept step in the same transaction as the entity (`functions/api/admin/proposals/_apply.ts`,
`originStamp` in `functions/_lib/bundle-origin.ts`), on the **node** and on each **edge** the bundle creates. An
`add-edge` stamps only an edge it creates, never one that was already there. A bundle cannot set these itself.
They name no Sanity id and no Sanity `_rev`: the Sanity sync's bundles stamp nothing.

| Property        | From a bundle of | Meaning                                                                                          |
|-----------------|------------------|--------------------------------------------------------------------------------------------------|
| `originOutline` | an outline       | Slug of the outline the entity was made from.                                                    |
| `originSha`     | an outline       | Hash of the outline's text (`outlineContentSha`) the bundle was made from: the version.          |
| `originBundle`  | outline, package | The bundle that created it.                                                                      |
| `originSection` | an outline       | The section the entity came from, when the payload named one.                                    |
| `importedFrom`  | a package        | The source ref (`<site><path>`, `sourceRefText`) of the entity in the archive it came from: how a later import finds it again. |

«Everything outline O produced» is `MATCH (n) WHERE n.originOutline = $slug` (and the same on edges); what was made
from an older version of the text is `n.originSha <> <the hash of the text now>`. These stamps describe this
archive's own history, so a package never carries them (`isBridgeProp`, `BUNDLE-FORMAT.md`).

### Attribute vs node rule

**Anything with its own source or lifecycle is a node. Pure scalar values stay as properties.**

A person's `birthDate` is a property. A person's *rank* is a node (`(:Person)-[:RANK]->(:Rank)`, with an optional `HELD_RANK` history) because it has its own source and time bounds.

---

## Node reference

Each section: identity · scalar properties · outbound relationships · inbound relationships · legacy properties awaiting migration.

### Person

**Identity**: `slug` · **Display**: `canonicalName`
**Properties**: `birthDate`, `deathDate`, `status`, `serviceClass`, `nationality`, `home`, `secretName`, `names[]`

Vocabularies:
- `status` ∈ `survived | KIA | MIA | deceased | unknown`
- `serviceClass` ∈ `military | civilian | unknown`
- `names[]` items: `{value, type, language, period, sourceRef}` where `type` ∈ `birth | service | code | nick | post-war | …`

**Outbound:**

| Edge                  | To                                        | Properties                                            |
|-----------------------|-------------------------------------------|-------------------------------------------------------|
| `MEMBER_OF`           | `Unit` \| `Organization`                  | `role, description, sourceRefs[], startDate, endDate` |
| `RANK`                | `Rank`                                    | `state, sourceRef` — exactly one: the rank the person is known by (PERSON-RANKS.md) |
| `HELD_RANK`           | `Rank`                                    | `id, from, to, acting, sourceRefs, state` — rank history, 0..n; partial dates |
| `HAS_RANK_NOTE`       | `Description`                             | per history entry — `Description.rankEntryId` = the edge's `id`, then `ABOUT_RANK` |
| `INVOLVED_IN`         | `Incident`                                | `role, outcome`                                       |
| `PARTICIPATED_IN`     | `Operation`                               | `role, startDate, endDate`                            |
| `STATIONED_AT`        | `Location` \| `Station`                  | `id, role, startDate, endDate, state, sourceRef, sourceRefs` — one edge per stay (docs/PERSON-STATIONED-AT.md) |
| `CREW_OF`             | `Transport`                               | `role` (controlled vocab — RAF WWII + SOE dispatcher) |
| `BORN_AT`             | `Location`                                | —                                                     |
| `HOME_AT`             | `Location`                                | —                                                     |
| `HAS_CONTENT`         | `Description`                             | sections                                              |
| `HAS_MEMBERSHIP_NOTE` | `Description`                             | relation-scoped — note then `ABOUT_UNIT` to the Unit  |
| `HAS_INCIDENT_NOTE`   | `Description`                             | relation-scoped — note then `ABOUT_INCIDENT`          |
| `HAS_OPERATION_NOTE`  | `Description`                             | relation-scoped — note then `ABOUT_OPERATION`         |
| `HAS_STATIONED_NOTE`  | `Description`                             | per stay — `Description.stayId` = the edge's `id`, then `ABOUT_PLACE` |

**Rules:**
- Every `Person` MUST have exactly one `RANK` edge (the rank they are known by). The default is `Rank{canonicalName:"Menig"}` (tier 1) with `sourceRef = 'sanity-migration:person:<id>:default:menig-soldier-baseline'`. The `HELD_RANK` history is optional.
- `MEMBER_OF` typically points at the most-specific Unit; parent Units/Orgs are reached via `PART_OF` traversal.

---

### Organization

**Identity**: `slug` · **Display**: `canonicalName`
**Properties**: `formalName`, `abbreviation`, `sortingName`, `color`, `country`, `foundedDate`, `dissolvedDate`, `type`, `names[]`

`type` (free text, common values): `allied-agency | military-branch | civilian-network | government | partner | …`

Top-level institutional entities: SOE, RAF, Milorg, Hæren, Marinen, government agencies, partners.

**Outbound:**

| Edge            | To             | Properties                       |
|-----------------|----------------|----------------------------------|
| `PART_OF`       | `Organization` | rare — sub-agency within a larger |
| `BASED_AT`      | `Location`     | —                                |
| `HAS_CONTENT`   | `Description`  | sections                         |
| `HAS_IMAGE`     | `Source`       | gallery                          |
| `REFERENCED_IN` | `Source`       | external links                   |

**Inbound:**
- `(:Unit)-[:PART_OF]->(o)`
- `(:Operation)-[:ORCHESTRATED_BY]->(o)`

**Relation-scoped notes** (annotates a specific pair):

```
(o)-[:HAS_MEMBER_UNIT_NOTE]->(:Description)-[:ABOUT_UNIT]->(:Unit)
```

---

### Unit

**Identity**: `slug` · **Display**: `canonicalName`
**Properties**: `formalName`, `type`, `color`, `country`, `foundedDate`, `dissolvedDate`, `names[]`. Course-typed units add: `courseLetter`, `startDate`, `studentCount`, `missingCount`, `targetGroup`, `order`.

`type` controlled vocabulary (extensible): `company | troop | team | patrol | squadron | flotilla | cell | district | course | …`

Formations / sub-groups: Kompani Linge, KP F, Eksportgrupper, MTB squadrons, Milorg D11–D40, training cohorts.

**Outbound:**

| Edge            | To                              | Properties                                                                        |
|-----------------|---------------------------------|-----------------------------------------------------------------------------------|
| `PART_OF`       | `Unit` \| `Organization`        | `role, description, order, sourceRefs[]`                                          |
| `BASED_AT`      | `Location`                      | —                                                                                 |
| `COVERS`        | `Location`                      | for districts with a geographic scope                                             |
| `HAS_CONTENT`   | `Description`                   | sections                                                                          |
| `HAS_IMAGE`     | `Source`                        | gallery                                                                           |
| `REFERENCED_IN` | `Source`                        | external links                                                                    |

`PART_OF.role` ∈ `administrative | operational | sponsor | parent`

**Inbound:**
- `(:Person)-[:MEMBER_OF]->(u)`
- `(:Unit)-[:PART_OF]->(u)` — nested sub-units
- `(:Operation)-[:ORCHESTRATED_BY]->(u)` (rare)

**Rules:**
- A Unit MAY have several `PART_OF` edges with different `role`s for dual reporting lines (e.g. KP F admin→HOK, operational→SOE).
- The legacy `District` label is **dissolved**: districts are `Unit{type:"district"}` with `COVERS Location[]`. Do not introduce a `District` label.
- Course units (`type:"course"`) carry the additional course-specific properties listed above.

**Legacy:** `(d:Description)-[:ABOUT]->(:Unit)` from the sanity-outline-migration. Migration target: convert to `(:Unit)-[:HAS_CONTENT]->(:Description)`.

---

### Operation

**Identity**: `slug` · **Display**: `canonicalName` (or `codeName` for purely-coded operations)
**Properties**: `codeName`, `objective`, `startDate`, `endDate`, `status`, `color`, `names[]`

`status` ∈ `planned | active | completed | terminated | abandoned | unknown`

Operations are journeys / missions / campaigns: they have an orchestrator, participants from various units, and (often) directional from→to start and end points. Incidents are the point-in-time events that happen during them.

**Outbound:**

| Edge                                    | To             | Properties                                            |
|-----------------------------------------|----------------|-------------------------------------------------------|
| `ORCHESTRATED_BY`                       | `Organization` | multi — orgs running the op                           |
| `ENDED_BY`                              | `Incident`     | when termination *is* an incident                     |
| `RELATED_TO {kind:'contains'}`          | `Incident`     | multi — enkeltepisoder under operasjonen              |
| `RELATED_TO {kind:'contains'}`          | `Operation`    | multi — deloperasjoner                                |
| `FROM`                                  | `Location`     | single — departure                                    |
| `TO`                                    | `Location`     | single — arrival                                      |
| `FROM_STATION`                          | `Station`      | single — base of departure                            |
| `TO_STATION`                            | `Station`      | single — base of arrival                              |
| `HAS_CELL`                              | `Location`     | `cellType, role, startDate, endDate`                  |
| `HAS_CONTENT`                           | `Description`  | sections                                              |

`HAS_CELL.cellType` controlled vocabulary: `HQ | amøbe | bi-celle | depot | …`

**Inbound:**
- `(:Operation)-[:RELATED_TO {kind:'contains'}]->(o)` — parent campaign (single in practice)
- `(:Person)-[:PARTICIPATED_IN]->(o)` — multi
- `(:Unit)-[:PARTICIPATED_IN]->(o)` — multi, units involved regardless of orchestrator (RAF squadrons, Norwegian patrols, Wehrmacht pursuers)

**Demote rules** — `PATCH /api/admin/event/:slug/kind` to `incident` blocks (409) if the Operation has any `ORCHESTRATED_BY` org or `(:Unit)-[:PARTICIPATED_IN]->` edges, since incidents don't carry these. Body `{force:true}` strips them in one transaction. Future extension: same blocker check for `FROM/TO/FROM_STATION/TO_STATION`.

---

### Incident

**Identity**: `slug` · **Display**: `title` (or `canonicalName`)
**Properties**: `date`, `time`, `type`, `outcome`, `outcomeReason`

`type` controlled vocabulary (extensible): `drop | arrest | sabotage | meeting | escape | crash | death | transport | …`

The "what happened" node. Point-in-time, single-place. Org/Unit context is **not** carried as direct edges — derived via parent operation, related people (`MEMBER_OF` walks), or related incidents.

**Outbound:**

| Edge                            | To              | Properties                          |
|---------------------------------|-----------------|-------------------------------------|
| `RELATED_TO {kind:'contains'}`  | `Incident`      | multi — sub-incidents               |
| `AT`                            | `Location`      | single — where it happened          |
| `AT_STATION`                    | `Station`       | single — radio station, airfield, etc. |
| `USED`                          | `Transport`     | `role`                              |
| `USED`                          | `EquipmentType` | `quantity, role`                    |
| `SOURCED_FROM`                  | `Source`        | provenance                          |
| `HAS_IMAGE`                     | `Source`        | gallery                             |

**Inbound:**
- `(:Operation)-[:RELATED_TO {kind:'contains'}]->(i)` — parent operation (single in practice)
- `(:Incident)-[:RELATED_TO {kind:'contains'}]->(i)` — parent incident
- `(:Person)-[:INVOLVED_IN]->(i)` — participants
- `(:Operation)-[:ENDED_BY]->(i)`

---

### Event hierarchy edge — `RELATED_TO`

A single edge type carries every Incident↔Operation containment relation. The `kind` property reserves the slot for richer semantics later (`'related'`, `'precedes'`, `'caused'`).

**Direction is always container → child**, regardless of the labels on either end:

| Edge                                                          | Meaning                                       |
|---------------------------------------------------------------|-----------------------------------------------|
| `(:Operation)-[:RELATED_TO {kind:'contains'}]->(:Incident)`   | enkeltepisoder under operasjonen              |
| `(:Operation)-[:RELATED_TO {kind:'contains'}]->(:Operation)`  | deloperasjoner                                |
| `(:Incident)-[:RELATED_TO {kind:'contains'}]->(:Incident)`    | underhendelser                                |

**Why one edge:** kind flips (`PATCH /event/:slug/kind`) become a pure label rename. Edges survive untouched — no rewrites, no illegal-combo blockers on the hierarchy. Replaces the earlier `PART_OF` (same-kind) + `OCCURRED_IN` (cross-kind) split.

Migration: `scripts/migrations/migrate-related-to.cypher` rewrites legacy edges; `scripts/migrations/migrate-incident-at.cypher` collapses Incident's directional `FROM`/`TO` into `AT`/`AT_STATION` (FROM wins when both exist).

---

### Event (legacy)

The pre-Round-3 import label. Currently coexists with `Incident`:
- `Event` nodes (~2156, from the Sanity `event` type import).
- `Incident` nodes (Round-3+, structured with the new model).

**Status: deprecated.** New nodes MUST be `Incident`. Existing `Event` nodes remain queryable until consolidated.

**Edges (legacy, still active):**

| Edge                       | To                | Notes                                            |
|----------------------------|-------------------|--------------------------------------------------|
| `DEPARTED_FROM_STATION`    | `Station`         | flight events                                    |
| `ARRIVED_AT_STATION`       | `Station`         | flight events                                    |
| `DEPARTED_FROM_LOCATION`   | `Location`        | non-station departures                           |
| `ARRIVED_AT_LOCATION`      | `Location`        | non-station arrivals                             |
| `USED`                     | `Transport`       | aircraft / vessel used                           |
| `RESULTED_IN`              | `Station`         | outcome — historic, sparse                       |

Migration target: `Event` → `Incident`, normalize `DEPARTED_FROM_STATION` → `FROM`, `ARRIVED_AT_STATION` → `TO`, drop `RESULTED_IN`.

---

### Location

**Identity**: `slug` · **Display**: `canonicalName`
**Properties**: `coordinates` (or `lat` + `lng`), `type`, `country`, `names[]`

`type` controlled vocabulary (extensible): `city | village | farm | building | mountain | coastal | …`

**Outbound:**

| Edge     | To         | Properties |
|----------|------------|------------|
| `WITHIN` | `Location` | hierarchy  |

**Inbound:**
- `(:Operation)-[:HAS_CELL]->(l)` `{cellType}`
- `(:Operation)-[:FROM|TO]->(l)` — single each, journey endpoints
- `(:Incident)-[:AT]->(l)` — single, where it happened
- `(:Unit)-[:BASED_AT|COVERS]->(l)`
- `(:Person)-[:BORN_AT|HOME_AT]->(l)`

---

### Station

**Identity**: `slug` · **Display**: `canonicalName` (legacy `title` on un-migrated nodes)
**Properties**: `category` (`training` | `base` | `other`; unset until someone sets it), `type` (free text, shown as *Funksjon* — `Airfield`, `MTB base`, `SOE Training School`, `Research and Development`, …), `lat`, `lng`, `activeFrom`, `activeTo`, `sourceRefs[]`

`sourceRefs[]` is one list for the whole station — what backs its facts (name, category, coordinates, dates): `<source-id>#page:A163`, same shape as on STATIONED_AT. Per-fact sources are not kept; a name has its own.

`category` is the one controlled value, set in the editor (Skole / Base / Annet). It only suggests a default role when a person is linked to the station (docs/PERSON-STATIONED-AT.md); the link's own role decides where the person is shown. The editor suggests a category from the free-text `type` (`src/utils/stationCategory.ts`) but never sets it by itself — the type is wrong for some stations (Stn. VIII is typed "SOE Training School", but was an R&D workshop).

**Outbound:**

| Edge            | To       | Properties           |
|-----------------|----------|----------------------|
| `HAS_CONTENT`   | `Description` | sections        |
| `HAS_NAME`      | `Name`   | other names (former, later, alias) |
| `HAS_IMAGE`     | `Source` | gallery              |
| `REFERENCED_IN` | `Source` | external links       |
| `EXTRACTED_FROM`| `Source` | provenance (legacy)  |

**Inbound:**
- `(:Person)-[:STATIONED_AT]->(s)`
- `(:Operation)-[:FROM_STATION|TO_STATION]->(s)` — single each
- `(:Incident)-[:AT_STATION]->(s)` — single
- `(:Event)-[:DEPARTED_FROM_STATION|ARRIVED_AT_STATION]->(s)` (legacy)

**Legacy properties not yet migrated:**

| Property                                                | Migration target                                                              |
|---------------------------------------------------------|-------------------------------------------------------------------------------|
| `description` (free text string)                        | → `(s)-[:HAS_CONTENT]->(:Description)` with the body Portable-Text'd          |
| `links` (JSON string of `[{title, link}]`)              | → `(s)-[:REFERENCED_IN]->(:Source)` per link                                  |
| `title` (display)                                       | → `canonicalName`                                                             |
| `sanityId` (only key on un-migrated nodes)              | → `slug` populated from the Sanity slug field                                 |


---

### Name

An other name of an entity — a place that was renamed, a unit with a former designation. The owner's `canonicalName` stays the one display name; a Name never repeats it. Station is the only owner so far; Person, Unit and Organization still use the older `names[]` convention (see open decision 2).

**Identity**: `id` (stable across saves) · **Display**: `value`
**Properties**: `order`, `value`, `type`, `from`, `to`, `fromAbout`, `toAbout`, `sourceRefs[]`

Vocabularies:
- `type` ∈ `former` (a name it had before `canonicalName`) | `later` (a name it got after) | `alias` (any other name it is known by)
- `from` / `to`: partial dates (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`), each end optional; open means unknown or still in use. `fromAbout` / `toAbout` mark the date as approximate ("omkring"); they are only meaningful when the date is set.
- `sourceRefs[]`: evidence, same shape as on STATIONED_AT (`<source-id>#page:A163`).

**Inbound:** `(:Station)-[:HAS_NAME]->(n)`. Saved as a whole list per owner (`PATCH /api/admin/station/:slug/names`); a name keeps its `id` while it exists.

Example — STS 3 was renamed STS 47 at the same site: the Station `STS 03 Stodham Park` has `(:Name {value: 'STS 47', type: 'later'})`.

---

### Transport

**Identity**: `slug` · **Display**: `canonicalName` (legacy `name` on un-migrated nodes)
**Properties**: `unit`, `regser`, `reserve`

Aircraft, fishing boats, MTBs, support craft.

**Outbound:**

| Edge            | To             | Properties          |
|-----------------|----------------|---------------------|
| `OF_CLASS`      | `VesselClass`  | classifies the vessel into the hierarchical taxonomy; drives crew-role validation |
| `HAS_CONTENT`   | `Description`  | sections            |
| `HAS_IMAGE`     | `Source`       | gallery             |
| `REFERENCED_IN` | `Source`       | external links      |
| `EXTRACTED_FROM`| `Source`       | provenance (legacy) |

**Inbound:**
- `(:Person)-[:CREW_OF {role}]->(t)` — `role` is a string validated against `CrewRole.APPLIES_TO_CLASS` walked from the Transport's `OF_CLASS`. See **Crew-role validation** under cross-cutting conventions.
- `(:Event)-[:USED]->(t)`

**Legacy properties not yet migrated:**

| Property                                | Migration target                                                                       |
|-----------------------------------------|----------------------------------------------------------------------------------------|
| `type` (free text — `Bomber`, `MTB`, …) | → `(:Transport)-[:OF_CLASS]->(:VesselClass)`. Map observed strings via a one-shot table to canonical class slugs, then drop the property. |
| `description` (free text string)        | → `(t)-[:HAS_CONTENT]->(:Description)`                                                 |
| `links` (JSON `[{title, link}]`)        | → `(t)-[:REFERENCED_IN]->(:Source)` per link                                           |
| `name` (display)                        | → `canonicalName`                                                                      |

---

### VesselClass

The hierarchical taxonomy of vessel kinds. `Transport` instances classify into a class via `OF_CLASS`; `CrewRole` declares which classes it's legal on via `APPLIES_TO_CLASS`. Two parallel roots — no global "vehicle" parent.

**Identity**: `slug` · **Display**: `canonicalName`
**Properties**: `description` (short, what the class covers)

**Outbound:**

| Edge      | To            | Notes                                                       |
|-----------|---------------|-------------------------------------------------------------|
| `PART_OF` | `VesselClass` | same-kind nesting only — taxonomy parent (e.g. `heavy-bomber → bomber → aircraft`) |

**Inbound:**
- `(:Transport)-[:OF_CLASS]->(c)`
- `(:CrewRole)-[:APPLIES_TO_CLASS]->(c)`
- `(:VesselClass)-[:PART_OF]->(c)` — child classes

**Seed taxonomy** (extend lazily as Transport instances appear):

```
aircraft
  ├─ bomber
  │    ├─ heavy-bomber       ← Halifax, Stirling, Lancaster
  │    └─ light-bomber       ← Mosquito, Hudson
  ├─ fighter                 ← Spitfire, Hurricane, Mustang
  ├─ transport-aircraft      ← Dakota
  ├─ flying-boat             ← Catalina, Sunderland
  └─ liaison                 ← Lysander

vessel
  ├─ fishing-boat            ← MK ARTHUR, Shetland Bus craft
  ├─ mtb                     ← MTB squadrons
  ├─ submarine               ← rare, allied insertion
  └─ merchant                ← if cargo movement is in scope
```

**Rules:**
- `PART_OF` is same-kind only (matches Unit/Org/Operation convention).
- A `Transport` MUST have exactly one `OF_CLASS` edge (it's the most specific applicable class — broader matches come from the `PART_OF*0..` walk).
- Seed extensibility: Jan can add new classes via admin; the class only needs `slug`, `canonicalName`, and a `PART_OF` parent (or null for a new root).

---

### Source

**Identity**: `id` (synthetic — `urn-nbn-…`, `youtube:…`, `archive:…`, `sanity:…`, `img:sanity:<asset-ref>`, etc.) · **Display**: `title` or `url`
**Properties**: `type`, `publishedDate`, `identifier` (URN:NBN, archive callsign, etc.), `url`, `domain`, `nbBacked`, `authorsFreeText`, `license`, `attribution`, `sanityAssetRef` (photographs), `kind` (photographs)

`type` controlled vocabulary: `book | archive | report | interview | newspaper | photograph | document | manual | rank-table | correspondence | editorial | artifact`

`nbBacked` (boolean) — Nasjonalbiblioteket-hosted (sorts first in UI link lists).

**Outbound:**

| Edge          | To       | Notes                                |
|---------------|----------|--------------------------------------|
| `AUTHORED_BY` | `Person` | when author is in graph              |

**Inbound (commonly read):**
- `(:Description)-[:CITES]->(s)` — inline footnote
- `(:Description)-[:SOURCED_FROM]->(s)` — section attribution
- `(:Description)-[:FROM]->(s)` — legacy ABOUT shape
- `(any)-[:HAS_IMAGE]->(s)`
- `(any)-[:REFERENCED_IN]->(s)`
- `(any)-[:EXTRACTED_FROM]->(s)` — Sanity-import provenance

**Licensing rule:** citation alone (no reuse) doesn't require `license`. Reuse requires both `license` and `attribution` populated.

---

### Outline

**Identity**: `slug` · **Display**: `canonicalName` (legacy `title` on un-migrated nodes)
**Properties**: `provenance` (where the document originated — `oss-hq-memo`, `soe-report`, `lokalhistoriewiki`, `wikipedia`, …); `archivedAt`, `archivedReason`, `absorbedSha`, `absorbedBundle` (set when a bundle made from the outline is fully accepted: the hash of the text it was made from, and the bundle)

A full source document — OSS memos, SOE reports, articles, scanned correspondence — kept as a first-class node rather than exploded into facts. Outlines are the **source material** the proposal pipeline reads to generate edits against entity nodes.

**Outbound:**

| Edge            | To       | Notes                                                                  |
|-----------------|----------|------------------------------------------------------------------------|
| `HAS_CONTENT`   | `Description` | the full document body (sections preserve the original structure) |
| `HAS_IMAGE`     | `Source` | gallery photos extracted from the outline                              |
| `REFERENCED_IN` | `Source` | external links cited in the outline                                    |
| `MENTIONS`      | `Person` \| `Operation` \| `Unit` \| `Station` \| `Transport` \| `Location` | named-entity references inside the document body |

**Inbound:**
- `(:Person|Unit|Operation|…)-[:USES_OUTLINE]->(o)` — manual attachment by Jan. v1: manual-only; selector-based auto-attach is deferred.

**Rules:**
- The outline node is **never written to by the bot pipeline** — Claude-generated proposals always target the entities the outline informs, not the outline itself. (Jan can still edit outlines manually through admin; "read-only" applies to the bot path, not to human editing.)
- Two informal subtypes (captured via `provenance`):
  - *Unit-shaped outlines* — already absorbed into `Unit` nodes during round-2/round-3 migration; the `Outline` node is retained for traceability.
  - *Documentary outlines* (memos, reports, articles) — the SEPALS-SFHQ case; lives entirely as an `Outline` node + `HAS_CONTENT` body + `MENTIONS` edges.

**Legacy properties not yet migrated** (Sanity import retains them on the node):

| Property                                              | Migration target                                                       |
|-------------------------------------------------------|------------------------------------------------------------------------|
| `description` (Portable Text array on the document)   | → `(o)-[:HAS_CONTENT]->(:Description)` per block-group                 |
| `gallery` (Sanity asset refs)                         | → `(o)-[:HAS_IMAGE]->(:Source {kind: 'photograph'})` per item          |
| `links` (JSON `[{title, link}]`)                      | → `(o)-[:REFERENCED_IN]->(:Source)` per link                           |
| `people` (Sanity refs)                                | → `(o)-[:MENTIONS]->(:Person)` per ref                                 |
| `title` (display)                                     | → `canonicalName`                                                      |
| `sanityId`                                            | → `slug` populated from Sanity slug field                              |

---

### Description

**Identity**: `id` (`desc:<kind>:<slug>:<order>` for HAS_CONTENT; arbitrary IDs on legacy ABOUT-stack)
**Properties**: `order`, `content` (JSON-stringified Portable Text). Legacy ABOUT-stack only: `recordedDate`, `author`.

**Outbound:**

| Edge              | To            | Properties     |
|-------------------|---------------|----------------|
| `CITES`           | `Source`      | `inline: bool` |
| `SOURCED_FROM`    | `Source`      | —              |
| `FROM`            | `Source`      | legacy ABOUT shape |
| `MENTIONS`        | (any)         | inline @-tags  |
| `RESPONDS_TO`     | `Description` | corrections    |
| `ABOUT`           | (any)         | legacy ABOUT shape |
| `ABOUT_UNIT`      | `Unit`        | relation-scoped notes (paired with `HAS_MEMBERSHIP_NOTE` from Person, `HAS_MEMBER_UNIT_NOTE` from Organization) |
| `ABOUT_INCIDENT`  | `Incident`    | relation-scoped notes (paired with `HAS_INCIDENT_NOTE` from Person) |
| `ABOUT_OPERATION` | `Operation`   | relation-scoped notes (paired with `HAS_OPERATION_NOTE` from Person) |

**Inbound:**
- `(any)-[:HAS_CONTENT {order}]->(d)` — the canonical pattern
- `(:Person)-[:HAS_MEMBERSHIP_NOTE|HAS_INCIDENT_NOTE|HAS_OPERATION_NOTE]->(d)` — person-scoped notes
- `(:Organization)-[:HAS_MEMBER_UNIT_NOTE]->(d)` — org-scoped notes about a member unit

---

### Rank

**Identity**: `canonicalName` scoped within `IN Organization` · **Display**: `canonicalName`, `abbreviation`
**Properties**: `tier` (numeric), `names[]` (variant spellings + languages)

**Outbound:**

| Edge            | To             | Notes                                           |
|-----------------|----------------|-------------------------------------------------|
| `IN`            | `Organization` | issuing service (Hæren, RAF, Marinen…)          |
| `EQUIVALENT_TO` | `Rank`         | cross-service mapping                           |
| `DEFINED_BY`    | `Source`       | rank tables, manuals                            |
| `DEPICTED_IN`   | `Source`       | insignia photos                                 |

**Inbound:**
- `(:Person)-[:RANK]->(r)` `{state, sourceRef}` — the known rank
- `(:Person)-[:HELD_RANK]->(r)` `{id, from, to, acting, sourceRefs, state}` — history

**Rule:** `Menig` (tier 1) is the default issued to every Person without an observed rank.

---

### CrewRole

The controlled vocabulary of vessel crew positions. Promoted from a string-on-edge to a node so role definitions can be cited, can carry language variants, and can declare which vessel classes they're legal on.

**Identity**: `slug` · **Display**: `canonicalName`, `abbreviation`
**Properties**: `description`, `service` (free text — `RAF`, `SOE`, `Marinen`, `Hæren`, `civilian`, …), `names[]` (variant spellings + languages)

**Outbound:**

| Edge                | To             | Notes                                                                |
|---------------------|----------------|----------------------------------------------------------------------|
| `APPLIES_TO_CLASS`  | `VesselClass`  | declares legality on a class — propagates to subclasses via `PART_OF*0..` |
| `IN`                | `Organization` | issuing service when role is service-scoped (RAF, SOE, Marinen, …)   |
| `EQUIVALENT_TO`     | `CrewRole`     | cross-service mapping (`WOp/AG` ↔ Norwegian equivalent)              |
| `DEFINED_BY`        | `Source`       | role glossaries, RAF Museum references, Guhnfeldt etc.               |
| `DEPICTED_IN`       | `Source`       | photos showing the role                                              |

**Inbound:**
- `(:Person)-[:CREW_OF {role: <slug>}]->(:Transport)` — `role` is the CrewRole `slug`, validated at write-time (see Crew-role validation).

**Seed vocabulary** (from `crew-roles` memory; extend lazily):

| Slug                 | Service     | Applies to (most-specific class) |
|----------------------|-------------|----------------------------------|
| `pilot`              | RAF, SOE    | `aircraft`                       |
| `co-pilot`           | RAF, SOE    | `aircraft`                       |
| `navigator`          | RAF, SOE    | `aircraft`                       |
| `bomb-aimer`         | RAF         | `bomber`                         |
| `wireless-operator`  | RAF, SOE    | `aircraft`, `vessel`             |
| `air-gunner`         | RAF         | `bomber`, `fighter`              |
| `flight-engineer`    | RAF         | `heavy-bomber`                   |
| `dispatcher`         | SOE         | `aircraft` (special-duties variants) |
| `skipper`            | civilian, Marinen | `vessel`                   |
| `mate`               | civilian, Marinen | `vessel`                   |

**Rules:**
- `CREW_OF.role` MUST resolve to a CrewRole `slug`. Free-text strings are rejected at the editor boundary.
- Service-scoping (`IN Organization`) is descriptive, not constraining — a role can apply across services if the historical record warrants.
- Spelling variants (Norwegian `flyger` for `pilot`, `WOp/AG` combined form, etc.) live in `names[]` with language tags, not as separate roles.

---

### EquipmentType

**Identity**: `slug` · **Display**: `canonicalName`
**Properties**: `type`, `subtype`, `country`, `period`, `names[]`

`type` controlled vocabulary: `radio | weapon | explosive | navigation | survival | vehicle-accessory | medical | …`

Categorical (a *type* of B2 radio, not a specific museum-held instance).

**Outbound:**

| Edge          | To              | Notes                                |
|---------------|-----------------|--------------------------------------|
| `PAIRED_WITH` | `EquipmentType` | symmetric (Eureka ↔ Rebecca)         |
| `DEPICTED_IN` | `Source`        | photograph                           |
| `DEFINED_BY`  | `Source`        | manual                               |

**Inbound:**
- `(:Incident)-[:USED]->(e)` `{quantity, role}`
- `(:Operation)-[:REQUIRED]->(e)` `{quantity}`
- `(:Organization)-[:ISSUED]->(e)`
- `(:Organization)-[:CAPTURED_FROM]->(e)`

**Rule:** spelling variants (e.g. Norwegian "Rebecka" vs canonical "Rebecca") go in `names[]` with language tags, not separate nodes.

Confirmed examples in source material: **OLGA** (agent radio), **BERIT** (agent radio), **EUREKA** (ground transponder) ↔ **Rebecca** (airborne receiver).

---

### Page + Card (CMS for editable public pages)

Replaces the Sanity `home` and `aboutUs` document types.

**Page** — Identity: `slug` · Properties: `title`, `subtitle`, `updatedAt`, `author`

**Card** — Identity: `id` · Properties: `section` (free text — typically `top` / `middle` / `bottom`), `sectionOrder` (1-based within section), `title?`, `subtitle?`, `heroImageRef?`, `type?`

`Card.type` controlled vocabulary (optional rendering hint, absent ⇒ plain text card): `hero | prose | entity-grid | activity-feed | timeline | gallery | quote`

**Edges:**

```
(p:Page)-[:HAS_CARD {order}]->(c:Card)
(c)-[:HAS_CONTENT {order}]->(d:Description)   // body
(c)-[:HAS_HERO_IMAGE]->(s:Source)             // when heroImageRef set
```

**Rule:** `section` + `sectionOrder` live on the Card, not on the `HAS_CARD` edge — moving a card between sections is a single property update, not a tree rewrite.

---

### Comment

Internal discussion / draft notes captured during migration. Not surfaced in production reads. Migration scripts may write these but the live data model treats them as sidecar.

---

### Activity

Homepage / activity-feed entries — what changed, when, by whom. Internal feed; not source-of-truth content.

**Identity**: `id` · **Properties**: `at` (ISO timestamp), `type` ∈ `created | described | connected | sourced | verified`, `summary`, `actor`

**Outbound:**

| Edge    | To    | Notes                                  |
|---------|-------|----------------------------------------|
| `ABOUT` | (any) | polymorphic — the entity that changed  |

---

## Polymorphic edges

These edges accept any first-citizen target — readers MUST verify the label in the query:

- `Description.ABOUT *` (Person/Incident/Operation/Organization/Location/Station/Transport)
- `Description.MENTIONS *` (inline @-tags)
- `Activity.ABOUT *`
- `Person.MEMBER_OF` → Unit *or* Organization
- `Outline.MENTIONS *` (any first-citizen entity referenced in the outline body)
- `(any).USES_OUTLINE` → Outline (entity declares it draws on this source document)

---

## Open decisions

1. **Station ↔ Location merge?** Station is currently its own label; could become `Location{type:'station-airfield'}` etc.
2. **`Person.names[]` as sub-document vs own node** — affects cross-entity name search. Decided for Station: own `Name` node (`HAS_NAME`). Person, Unit, Organization and the rest still carry `names[]` until they get an editor.
3. **Full node versioning** — partially answered for PT blocks by the `previous*` one-step revert + the R2 `history/` append-only log (see `PROPOSALS.md`). A broader `EditEvent` stream covering scalars and edges remains deferred until mis-edit recovery on those becomes a real need.
4. **Migrate Unit `(:Description)-[:ABOUT]->` stack to `(:Unit)-[:HAS_CONTENT]->`.** Drop the legacy ABOUT shape once done.
5. **Migrate Station / Transport `description` (free text) + `links` (JSON) to `HAS_CONTENT` + `REFERENCED_IN`.**
6. **`Event` → `Incident` consolidation.** Both labels coexist; the legacy `Event` import is read-only.
7. **Outline ingestion for documentary outlines.** Lift `description` to `HAS_CONTENT`, `gallery` to `HAS_IMAGE`, `links` to `REFERENCED_IN`, `people` to `MENTIONS`. The `Outline` node currently carries the legacy properties verbatim.
8. **`Transport.type` (free text) → `OF_CLASS` (`VesselClass` node).** Build the one-shot mapping table from observed `type` strings (`Bomber`, `MTB`, `Fishing boat`, …) to canonical class slugs from the seed taxonomy, run it once, then drop the property. Editor must reject unmapped vessel classes — Jan adds new ones via admin instead of free-texting.
