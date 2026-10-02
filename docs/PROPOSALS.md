---
status: draft
audience: developer (Benny) + future-Jan via UI
---

# Proposals — Sanity → Neo4j change review system

## Goal

Replace the "big-bang Sanity → Neo4j migration" with a **proposal flow** that
keeps the live graph stable and lets Jan approve or reject schema-shaped
changes one block at a time, from inside the existing admin UI.

The migration becomes a **proposal generator**, not a writer. It emits
candidate diffs to Cloudflare R2; the admin UI surfaces them as markers near
the data; Jan opens the marker, sees a side-by-side preview, and accepts or
denies per block, with an optional message captured into the audit trail.

## Scope (v1)

**Bundle is the proposal unit; entity is the review unit.** A single
outline-absorption can touch many entities in many ways — create new
nodes, modify PT blocks on existing nodes, add edges, archive the
outline once its content has been distributed. The bot generates one
**bundle** per outline-absorption; Jan reviews it **one entity at a
time**, accepting or denying each independently.

**Per-entity accept/deny within a bundle.** Each entity in a bundle
carries its own `pending | accepted | denied` status. Bundle is closed
once every entity is non-pending. If all entities deriving from an
outline end up accepted, the outline auto-archives.

**Apply is a single Neo4j transaction per accepted entity.** Creating
the entity, applying its PT body, attaching its outbound edges — all
one transaction. Partial application is forbidden. Edges to entities
that Jan has denied are dropped (with prior visual warning in the
preview — see "Edge-crossing policy" below).

**Every write is one-step revertible.** Whether it's the initial
import, an accepted bundle op, or one of Jan's manual edits, the
previous value of the block / edge / entity is preserved in-place so a
single click returns it to its prior state.

**Preview reuses live detail components via a composable swap.** Jan
clicks an entity in a bundle's review list → the same `PersonDetail` /
`UnitDetail` / etc. component renders, but with `useProposalEntityData`
in place of the live composable. Edges to not-yet-created entities
render as ghost chips that Jan can click through. See "Controller-view
preview" below.

## Data flow

```
Sanity (CMS)
    │  (one-shot or scheduled run)
    ▼
generator  ─── reads current Neo4j too, to skip already-aligned values
    │          and consults provenance stamps to decide drift state
    ▼  writes JSON
Cloudflare R2
    │
    ▼  GET via Worker
Worker (functions/api/proposals/[entityId].ts)
    │  recomputes current SHA from Neo4j, drops drifted entries
    ▼
Admin UI
    │  shows marker badge on entity views, opens diff preview
    ▼
Jan accepts / denies / reverts (with optional message)
    │
    ├─►  Neo4j write (the actual state change), stamping previous*
    └─►  R2: append to history/, move proposal into accepted/ or denied/,
            update manifest
```

## Provenance stamps

Every Sanity-sourced node and PT block carries lineage so the generator can
distinguish "untouched import" from "Jan edited this locally":

- `sanityId` — stable Sanity document ID
- `sanityRev` — Sanity's `_rev` at import time (cheap upstream-change check)
- `sanityImportedAt` — ISO timestamp
- `sanitySha` — sha256 of the imported value (stable-key-ordered JSON)

For PT blocks these live as properties on the block-level node (or on the
section node addressed by `blockPath`); for entity nodes they live on the
node itself.

### Drift detection — 2×2

|                            | Neo4j sha == sanitySha                  | Neo4j sha != sanitySha                              |
|----------------------------|-----------------------------------------|------------------------------------------------------|
| Sanity \_rev == sanityRev  | untouched on both sides                 | locally edited, no upstream change → **leave alone** |
| Sanity \_rev != sanityRev  | upstream changed only → **safe auto-propose** | both sides changed → **conflict proposal, Jan reconciles** |

Local-edit detection requires a hook: every admin-UI write path that
touches a Sanity-stamped block must append to the history log (see below)
and clear / invalidate `sanitySha` on that block. Without the hook, drift
is detected lazily by the generator and you lose the timeline.

## Single-step revert

Every write to a PT block — initial import, accepted proposal, manual edit
— stamps the block in Neo4j with:

- `previousValue` — full PT JSON of what was there before
- `previousSha` — its sha
- `previousAt` — ISO timestamp
- `previousSource` — `"sanity-import"` / `"proposal:<ts>"` / `"manual-edit"`

Revert = swap `previousValue` back in, then clear the `previous*` fields.
**One step back is the contract** — no infinite undo. The UI shows a small
"↶ Revert to <previousSource> from <previousAt>" affordance whenever
`previousValue` is non-null.

If Jan needs to go further back than one step, the durable history log
(below) is the source of truth.

## History log

Every write event (import, proposal accept, manual edit, revert) appends
one file to R2:

```
history/<entityId>/<ts>-<blockPath>.json
```

Append-only, no consistency concerns. Contains the event kind, the value
before, the value after, both shas, and the source/actor. Jan never sees
this directly in v1, but it's the recovery surface if the in-Neo4j
`previous*` fast-path isn't enough.

## R2 layout

```
proposals/bundles/<bundleId>/
  manifest.json                            ← entity list + per-entity status (the review unit)
  entity/<entityId>.json                   ← per-entity ops payload
  accepted/<entityId>-<ts>.json            ← archive + optional accept message
  denied/<entityId>-<ts>.json              ← archive + mandatory deny reason

proposals/by-entity/<entityId>/index.json  ← which open bundles touch this entity (drives marker badge)
proposals/by-outline/<outlineId>/index.json ← which open bundles derive from this outline
proposals/by-source/sanity-<type>/index.json ← which open sync bundles come from this Sanity type

denied-corpus/<kind>.json                  ← cross-entity denial index (suppression + learning)
denial-analyses/<kind>/<entityId>/<ts>-<entitySlug>.json  ← Claude's structured analysis of one entity-level denial
history/<entityId>/<ts>-<eventKind>.json   ← append-only event log per entity (apply / revert / manual edit)
bot-history/<YYYY>/<MM>/<issueNumber>.json ← archived bot-task + bot-deny-analysis issues
```

`<bundleId>` is `bundle:<channel>:<isoTimestamp>` — the channel being the
outline id, or `sanity-<type>` for sync bundles (see "Bundle origin") — so
it's deterministic and human-readable in URLs. `<entityId>` keeps the `<Kind>:<slug>`
shape used elsewhere.

The **marker badge** for an entity reads
`proposals/by-entity/<entityId>/index.json` and counts open bundles —
not ops. One bundle touching an entity = one badge, regardless of how
many ops within the bundle target it.

**`<blockPath>.json`** — one file per PT block proposal, addressed by
stable block path (`section.<slug>.block.<blockKey>` or similar). Drift
checked individually so a one-character edit in section A doesn't dismiss
proposed changes in unrelated blocks.

**`index.json`** — small manifest enumerating what files exist for this
entity. One fetch tells the UI whether to render a marker badge at all,
without doing an `R2.list()` on every page load.

## Bundle origin

A bundle comes from one of two places (`functions/_lib/bundle-origin.ts`):

| | Outline (Claude) | Sanity sync (docs/SANITY-SYNC.md) |
|---|---|---|
| Manifest | `outlineId`, `outlineRev` | `origin: {type: 'sanity', sanityType, runAt}` |
| Per entity `derivedFrom` | `{outlineId, outlineRev, sectionPath?}` | `{sanityId, sanityRev}` |
| Channel (bundle id, live updates) | `<outlineId>` | `sanity-<type>` |
| Source index | `by-outline/<outlineId>` | `by-source/sanity-<type>` |
| On full accept | outline archived (`obsolete-outline`) | — |
| GitHub issue, resolve dispatch | yes | no |

Ingest takes exactly one of the two. Sync bundles use `model: 'sanity-sync'`
and a rule version as `promptHash`. The live-update stream is
`/api/proposals/events?channel=<channel>` (`outlineId=` still accepted).

## Bundle shape

A bundle is one outline-absorption proposal, or one sync run's proposals
for a Sanity type. It carries a manifest +
per-entity payloads. Ops within an entity's payload are typed via a
discriminator.

### Bundle manifest

```jsonc
// proposals/bundles/<bundleId>/manifest.json
{
  "bundleId":    "bundle:linge-pulje-4:2026-04-29T14:00:00Z",
  "outlineId":   "linge-pulje-4",
  "outlineRev":  "<Sanity _rev at generation time>",
  "summary":     "Absorb Pulje 4 outline: 1 new Operation, 3 new Persons, 1 biography update on existing Person, archive the outline.",
  "createdAt":   "2026-04-29T14:00:00Z",
  "model":       "claude-opus-4-7",
  "promptHash":  "<sha first 12 of proposal-bundle.txt>",
  "entities": [
    { "entityId": "Operation:linge-pulje-4",  "status": "pending",  "opSummary": ["create", "5 outbound edges"] },
    { "entityId": "Person:anderssen-erik",    "status": "pending",  "opSummary": ["create", "1 outbound edge"] },
    { "entityId": "Person:warberg-jan",       "status": "pending",  "opSummary": ["modify biography section"] },
    { "entityId": "Outline:linge-pulje-4",    "status": "pending",  "opSummary": ["archive (auto, derived from acceptance state)"] }
  ]
}
```

Each entity carries one of: `pending | accepted | denied | drifted`.
`drifted` is set when an op's `expectedSha` no longer matches Neo4j and
the live state has moved past what the op assumed; the entity is
filtered from the review UI and recoverable in `bundles/<bundleId>/drifted/`.

### Per-entity payload

```jsonc
// proposals/bundles/<bundleId>/entity/<entityId>.json
{
  "entityId":   "Operation:linge-pulje-4",
  "ops": [
    {
      "op":     "create-entity",
      "kind":   "Operation",
      "slug":   "linge-pulje-4",
      "props":  { "canonicalName": "Linge Pulje 4", "startDate": "1942-03", "endDate": "1942-05", ... },
      "edges":  [
        { "type": "ORCHESTRATED_BY", "to": "Organization:soe", "props": {} },
        { "type": "PART_OF",         "to": "Operation:linge-training-programme", "props": {} }
      ]
    }
  ],
  "derivedFrom": { "outlineId": "linge-pulje-4", "sectionPath": "overview", "outlineRev": "..." },
  "source":      "claude:outline:linge-pulje-4:overview",
  "generatedAt": "2026-04-29T14:00:00Z"
}
```

### Op vocabulary (discriminated by `op`)

```jsonc
// Create a new entity, optionally with outbound edges in one shot.
{
  "op":    "create-entity",
  "kind":  "Person | Unit | Operation | Incident | Station | Transport | Location | Outline",
  "slug":  "<entity slug>",
  "props": { /* scalar properties from the kind's SCHEMA.md spec */ },
  "edges": [
    { "type": "<EDGE_TYPE>", "to": "<targetEntityId>", "props": { /* edge metadata */ } }
  ]
}

// Modify one PT block on an existing entity. Carries expectedSha for drift detection.
{
  "op":          "modify-block",
  "blockPath":   "section.biography.block.k7f3",
  "expectedSha": "<sha of current block at generation time>",
  "newValue":    { /* PT block JSON, _type: "block", children: [...] */ }
}

// Add an edge to/from an existing entity (when not part of a create-entity op).
{
  "op":    "add-edge",
  "type":  "MEMBER_OF",
  "from":  "Person:anderssen-erik",
  "to":    "Unit:kompani-linge",
  "props": { "role": "operative", "startDate": "1942-05" }
}

// Remove an edge.
{
  "op":   "remove-edge",
  "type": "MEMBER_OF",
  "from": "Person:warberg-jan",
  "to":   "Unit:linge-pulje-3"   // wrong cohort attribution being corrected
}

// Delete an entity (rare in v1; mostly used for near-duplicate merges).
{
  "op": "delete-entity"
  // entityId on the payload identifies which entity is being deleted
}

// Archive an outline. v1 derives this automatically from acceptance state,
// but the op is reified so the bundle is self-describing.
{
  "op":     "obsolete-outline",
  "reason": "fully absorbed into the operation node and 3 person nodes"
}
```

Per-entity payloads can mix multiple ops — e.g. an existing Person can
have both `modify-block` and `add-edge` ops in the same bundle. Apply
order within an entity is op-array order; cross-entity apply order
respects the dependency graph (referenced targets created before
referrers).

## Controller-view preview

The diff panel does not implement bespoke render code per entity kind.
It reuses the existing detail components by **swapping the data
composable** they consume.

### How it works

Every detail page consumes a per-kind data composable:
- `usePersonData(slug)`   → `PersonDetail.vue`
- `useUnitData(slug)`     → `DistrictDetail.vue`  (Unit kind)
- `useOrganizationData(slug)` → `OrganizationDetail.vue`
- `useStationData(slug)`  → `StationDetail.vue`
- `useTransportData(slug)` → `TransportDetail.vue`
- `useIncidentData(slug)` → `EventDetail.vue`     (after composable extraction — see Build phases)
- `useOutlineData(slug)`  → `OutlineDetail.vue`   (after composable extraction)

The proposal-preview composable returns the same reactive shape as the
matching live composable, plus a `_proposal` sidecar:

```ts
useProposalEntityData(bundleId: string, entityId: string)
  → { /* same shape as the kind's live composable */
      _proposal: {
        bundleId,
        status: 'pending' | 'accepted' | 'denied' | 'drifted',
        ops:    BundleOp[],          // the entity's payload ops
        conflicts?: { blockPath, currentSha, expectedSha }[]   // populated when drift is detected
      }
    }
```

Detail components ignore `_proposal` and render against the merged data
(live + pending overlay) — they don't need to know they're in
preview mode. A small **proposal-review wrapper** consumes `_proposal`
to render the chrome (status badge, accept/deny buttons, conflict
warnings, navigation crumbs).

### Merge logic (`useProposalEntityData` internals)

For each op in the entity's payload:

| Op                  | Effect on returned shape                                                                |
|---------------------|------------------------------------------------------------------------------------------|
| `create-entity`     | Start from empty state, populate `props` + outbound `edges` from the op.                 |
| `modify-block`      | Start from live Neo4j state, replace the matched block in the relevant `Description`.    |
| `add-edge`          | Append to outbound edges array, tag `pendingFromBundle: <bundleId>`.                     |
| `remove-edge`       | Filter from outbound edges, tag the matching live edge as `pendingRemoval: true`.        |
| `delete-entity`     | Return live state with `pendingDelete: true`.                                            |
| `obsolete-outline`  | (only on the outline entity) return live state with `pendingArchive: true`.              |

For every edge in the merged result, resolve the target against the
live graph + the bundle's other entity creations:

```ts
edge.targetExists       = true   // the target is in live Neo4j
edge.pendingFromBundle  = bundleId         // the target is being created elsewhere in this bundle
edge.targetExists       = false  // ghost — render with dashed-border + desaturated chip styling
```

### Navigation

Ghost edges render as clickable chips that route to
`/proposals/<bundleId>/preview/<targetEntityId>` — same router-view,
the composable swap kicks in for the target. Jan can browse the
bundle's pending world by following ghost links from one entity to
another, never leaving proposal-preview mode until he accepts/denies.

### Why this works

- **No new components per kind.** The detail pages already exist; they
  render whatever their composable returns. Preview is a controller
  swap, not a parallel UI tree.
- **Modifications layer cleanly.** A `modify-block` proposal on an
  existing Person renders that Person's full live page with the
  proposed block in situ — Jan sees the change in context, not
  isolated.
- **Cross-entity coherence is implicit.** If Person A has an
  `add-edge` to created-but-not-yet-accepted Person B, A's preview
  shows the edge as ghost. Click it → land in B's preview. Accept B,
  then A's preview re-renders with the edge live (or accept A first
  and the edge stays ghost until B is also accepted; the apply step
  drops it if B is denied).

### Edge-crossing policy

When some entities in a bundle are accepted and others denied, edges
crossing the boundary become orphan. Three policies were considered:

1. **Drop silently** (lossy, hides intent).
2. **Visually flag in preview, allow accept** (lean — Jan sees what
   he loses, retains agency).
3. **Block accept until all crossing entities are decided** (annoying
   for Jan, slows review).

We use **(2)**. When an op references a denied target, the preview
renders the affected edge with a "this edge will be dropped if you
accept (target was denied: <reason>)" inline note. Jan can deny this
entity too, undeny the target, or proceed knowing the edge is lost.
History log records the dropped edge as an event so it's recoverable.

### Cross-entity coherence — when both endpoints are existing

For an `add-edge` between two existing entities (e.g. existing Person
+ existing Unit), the edge appears in the merged view of **both**
endpoints. The bundle is the source of truth; both preview composables
read from it. Accepting from either endpoint flips the bundle's state
and updates both previews via SSE.

## SHA + drift logic

Each proposal pins to the **current Neo4j value's** content hash at
generation time (`expectedSha`). On every read, the Worker recomputes the
hash from live Neo4j and compares:

- **match** → proposal still applicable → return to UI
- **mismatch** → silently filter out (Jan never sees it); move the file
  into `drifted/` so it's recoverable rather than lost

Hashing rules:
- PT blocks: `sha256(JSON.stringify(block))` with stable key ordering —
  hash per block, never per whole section, so fine-grained edits don't
  nuke unrelated proposals

## Concurrency — R2 conditional writes

R2 implements S3-style conditional headers. We use them on every mutation
of shared files to defeat two-tab races:

- `If-Match: <etag>` on PUT → only writes if current etag matches; 412
  otherwise. Used on `index.json`.
- `If-None-Match: *` on PUT → create-only. Used when writing to
  `accepted/<ts>-…json`, `denied/<ts>-…json`, `drifted/<ts>-…json`, and
  history-log entries.

Per-block proposal files are single-writer per accept (gated by
`index.json`'s etag), so no conditional header on the block file itself.
Etag is the MD5 of the object content for normal (non-multipart) PUTs, so
it naturally functions as a content-hash check.

## Denied-proposal corpus

A flat per-kind index of every denial across all entities, sharded by
entity kind:

```
denied-corpus/Person.json
denied-corpus/Unit.json
denied-corpus/Operation.json
…
```

Each entry is denormalized from the per-entity `denied/<ts>-<blockPath>.json`
file so consumers don't have to walk the whole `proposals/` tree:

```jsonc
{
  "deniedAt":       "2026-04-28T14:00:00Z",
  "entityId":       "person-warberg-jan",
  "kind":           "Person",
  "blockPath":      "section.biography.block.k7f3",
  "newValue":       { /* PT block JSON that was proposed */ },
  "newValueSha":    "<sha of newValue>",
  "suppressionSig": "<sha256(blockPath + ':' + newValueSha)>",
  "reason":         "Jan considers this anachronistic",
  "source":         "claude:outline:soe-agent:training",
  "outlineId":      "soe-agent",
  "model":          "claude-opus-4-7",
  "ref":            "proposals/person-warberg-jan/denied/2026-04-28T140000Z-section.biography.block.k7f3.json"
}
```

The corpus has two consumers:

**1. Suppression on re-runs.** The generator (Sanity-side) and the bot
(outline-side) both consult the corpus before emitting a proposal:

> Before writing a proposal for `(entityId, blockPath, newValue)`, check
> `denied-corpus/<kind>.json` for any prior denial whose
> `(blockPath, newValueSha)` signature matches **for this entityId**.
> If found, **skip** — do not regenerate.

Per-entity matching for suppression — different entities can legitimately
need similar content. Skipping by `(blockPath, newValueSha)` globally
would suppress valid proposals for other people just because Jan denied
the same text once.

**2. Learning corpus for the bot.** When constructing a prompt, the bot
includes the top-N most relevant denials from `denied-corpus/<kind>.json`
as few-shot negative examples ("Jan rejected these recent proposals for
similar entities; don't repeat the same patterns"). Relevance ranking is
out of scope for v1 — start with "most recent N for this kind + outline,"
revise once we see what Jan rejects.

### Corpus maintenance

- The Deny endpoint appends to `denied-corpus/<kind>.json` (with `If-Match`
  on the etag) as part of its side-effect chain — see Accept / Deny /
  Revert API contract.
- Idempotent on `(deniedAt, entityId, blockPath)` — a retry that finds
  the same key in the corpus overwrites with the same content; no
  duplication.
- Append-only: corpus entries are never deleted. If Jan later wants to
  withdraw a denial, the right move is to manually re-request the
  proposal (a fresh proposal supersedes the old denial's suppression
  because `newValueSha` will differ on regenerated content).
- Sharding by kind keeps each file small enough to read+rewrite in one
  Worker request even at thousands of denials. If a single kind ever
  outgrows that, shard further by month inside the kind.

Accepted entries are *not* added to the corpus — re-generating an
already-accepted proposal would just no-op at apply time (the new value
already matches Neo4j, so no diff exists to propose).

## Apply atomicity

Accepting an entity within a bundle applies all of that entity's ops in
**one Neo4j transaction**. Partial application is forbidden — either
the entity is fully created/modified with all its outbound edges (those
whose targets exist or are pending in the same bundle), or nothing is
written and the accept fails.

Edges to denied targets are **dropped at apply time**, recorded in the
history log as `{kind: "edge-dropped", reason: "target denied"}` so
the loss is auditable. Jan saw the warning in the preview before
accepting; he chose to proceed.

R2 mutations bracket the Neo4j transaction:

1. **Intent lock** — write `accepted/<entityId>-<ts>.json` with
   `If-None-Match: *`. Acts as a uniqueness guard against double-accept
   races.
2. **Apply** — single Neo4j transaction:
   - For `create-entity`: `CREATE (e:<Kind> {...})` + outbound `CREATE` edges
   - For `modify-block`: locate Description, replace block by `_key`, stamp `previous*`
   - For `add-edge` / `remove-edge`: the obvious mutations
   - For `delete-entity`: `DETACH DELETE` (with confirmation guard)
   - For `obsolete-outline`: set `archivedAt` + `archivedReason` properties
3. **Cleanup** — patch `bundles/<bundleId>/manifest.json` with
   `If-Match` to flip the entity's status to `accepted`. Append to
   `history/<entityId>/<ts>-apply.json`. Update
   `by-entity/<entityId>/index.json` and `by-outline/<outlineId>/index.json`.
4. **Auto-archive check** — if every entity in the bundle that
   derives from the bundle's outline is now non-pending, and the
   bundle includes an `obsolete-outline` op (or all derived entities
   are accepted), apply the outline archival as a final transaction.

**Failure recovery.** If Neo4j fails mid-transaction, the transaction
rolls back; the `accepted/` intent file is leftover, but a janitor pass
on read sees `accepted/` exists with no manifest update and can either
retry the apply (idempotent — most ops are MERGE-safe) or delete the
stale intent.

## Accept / Deny / Revert — API contract

Routes are entity-scoped within a bundle. Auth is the existing admin
session that gates `/api/admin/*`. No additional gating beyond that —
these routes are not public.

### List + count for one entity

```
GET /api/admin/<kind>/<slug>/proposals             — full pending bundles for this entity
GET /api/admin/<kind>/<slug>/proposals?count=true  — just the marker-badge count
```

Reads `proposals/by-entity/<entityId>/index.json`, fetches each
referenced bundle's manifest + this entity's payload, returns the
list. `?count=true` returns just `{ pendingCount: <n> }` (number of
open bundles touching the entity).

### List a bundle

```
GET /api/admin/proposals/<bundleId>                — bundle manifest + every entity payload
```

Used by the bundle review page. Returns the manifest plus every
per-entity payload inline (small enough — typical bundle has 1-30
entities). The proposal-preview composable consumes this.

### Accept (one entity within a bundle)

```
POST /api/admin/proposals/<bundleId>/<entityId>/accept
```

**Request body:**
```jsonc
{
  "message":     "matches the AIR 27 entry",                              // optional
  "expectedShas": { "section.biography.block.k7f3": "<sha Jan saw>" }     // for modify-block ops only
}
```

`expectedShas` is keyed by `blockPath` for every `modify-block` op in
the entity's payload. Drift on any single one fails the whole accept
with 409.

**Side-effects, in order (see Apply atomicity):**

1. Read the entity's payload. If status is not `pending`, **409** — already decided.
2. For each `modify-block` op: recompute current Neo4j SHA for that
   block. Mismatch with `expectedShas[blockPath]` → **409 Conflict**
   with the drifted block paths in the response body.
3. Write `bundles/<bundleId>/accepted/<entityId>-<ts>.json` with
   `If-None-Match: *` (intent lock; double-accept races fail here).
4. Apply ops as one Neo4j transaction (see Apply atomicity).
   Edges to denied targets are dropped, recorded in history.
5. Append `history/<entityId>/<ts>-apply.json` with the transaction summary.
6. Patch `bundles/<bundleId>/manifest.json` with `If-Match` to flip
   the entity's status to `accepted`. Retry on 412 (max 3).
7. Patch `proposals/by-entity/<entityId>/index.json` and
   `proposals/by-outline/<outlineId>/index.json` to remove the bundle
   reference if no other entities in this bundle still touch this
   entity / are pending.
8. **Auto-archive check** — if every other entity in the bundle is
   non-pending and the bundle includes an `obsolete-outline` op (or
   all derived entities are accepted), apply the outline archival as
   a final transaction and patch `Outline:<id>` to `archivedAt = now`.
9. Push SSE event `proposal-accepted` to subscribers of the relevant
   entity stream(s).

**200 response:** `{ bundleId, entityId, status: 'accepted', remainingPending: <n>, bundleClosed: <bool>, outlineArchived: <bool> }`.

**Error responses:**
- `409 Conflict` (drift) — body `{ kind: "drift", driftedBlocks: [{ blockPath, expectedSha, actualSha, currentValue }] }`
- `409 Conflict` (already decided) — body `{ kind: "already-decided", currentStatus }`
- `404 Not Found` — bundle or entity not found.
- `412 Precondition Failed` — manifest patch raced. Surface as
  transient.
- `401 Unauthorized`.

### Deny (one entity within a bundle)

```
POST /api/admin/proposals/<bundleId>/<entityId>/deny
```

**Request body:**
```jsonc
{
  "reason": "Jan's reasoning — free-form, multiline. Why was this proposal wrong? What did the bot misunderstand? What source contradicts it?"
}
```

`reason` is **mandatory**, free-form, multiline. This is the
load-bearing input to the denied-proposal corpus and the
denial-analysis pipeline.

**UX expectations (admin):**
- Free-form multiline textarea.
- Placeholder copy nudges substance.
- Norwegian or English — corpus stores verbatim.
- Server rejects empty / whitespace-only / single-character reasons.

**Side-effects, in order:**

1. If status is not `pending`, **409**.
2. Validate `reason` is non-trivial → 400 otherwise.
3. Write `bundles/<bundleId>/denied/<entityId>-<ts>.json` with
   `If-None-Match: *`.
4. Append to `denied-corpus/<kind>.json` with `If-Match` (retry max 3).
5. Append `history/<entityId>/<ts>-deny.json`. No Neo4j writes.
6. Patch `bundles/<bundleId>/manifest.json` with `If-Match` to flip
   the entity's status to `denied`.
7. Patch `proposals/by-entity/<entityId>/index.json` (remove this
   bundle if no other pending entities here).
8. **If `reason.length >= 40`**, fire-and-forget create a
   `bot-deny-analysis` GitHub issue. Failures here do not fail the
   request.
9. Push SSE event `proposal-denied` to subscribers.

**200 response:** `{ bundleId, entityId, status: 'denied', remainingPending: <n>, bundleClosed: <bool> }`.

**Error responses:** same shape as accept, plus:
- `400 Bad Request` — `reason` missing / empty / trivial.

### Revert (one block on a live entity)

```
POST /api/admin/<kind>/<slug>/proposals/revert
```

**Request body:**
```jsonc
{ "blockPath": "section.biography.block.k7f3" }
```

Independent of the bundle flow — undoes the most recent write to a
block on a live entity by swapping `previousValue` back in. Used for
the "↶ Revert to <previousSource> from <previousAt>" affordance that
appears whenever a block has non-null `previousValue` (regardless of
whether the prior write was an import, an accepted proposal, or a
manual edit).

**Side-effects, in order:**

1. Read the block from Neo4j. If `previousValue` is null, **400**.
2. Swap: `content = previousValue`, set `previousValue = <prior content>`, set `previousAt = now`, set `previousSource = "revert"`. (One step back stays the contract.)
3. Append `history/<entityId>/<ts>-revert.json`.
4. Push SSE event `proposal-reverted` to subscribers.

**200 response:**
```jsonc
{ "blockPath": "...", "currentValue": { /* now-live (prior) */ }, "previousValue": { /* now-prior (was-current) */ } }
```

**Error responses:**
- `400 Bad Request` — no prior value.
- `401 Unauthorized`.

### Bot ingest (separate auth, separate route)

```
POST /api/proposals/ingest
```

Used by the bot-task GitHub Action only; HMAC-authed via
`X-Hub-Signature-256: sha256=<hmac(BOT_INGEST_SECRET, body)>`. Not
admin-session-gated.

**Request body:** the bundle as defined in **Bundle shape** — manifest
+ per-entity payloads. Plus `{ issueNumber }` for the close-back step.

**Side-effects:**

1. Verify HMAC; on mismatch, **401**.
2. Validate bundle shape: every entity in `manifest.entities` has a
   matching `entity/<entityId>.json` payload, every op type-checks
   against its discriminator, edge targets resolve to either live
   entities or other entities being created in the same bundle. On
   fail, **400** with details.
3. Compute current Neo4j SHA for every `modify-block` op → set as
   `expectedSha` on the op (overwriting whatever the bot sent — Neo4j
   is the source of truth).
4. Write `bundles/<bundleId>/manifest.json` and every
   `bundles/<bundleId>/entity/<entityId>.json`. Overwrite policy:
   bundleId is timestamped so collisions don't happen except on
   intentional re-runs (fresh bot output for the same outline →
   different timestamp → different bundleId).
5. Update `proposals/by-entity/<entityId>/index.json` for each entity
   in the bundle, with `If-Match` retry.
6. Update `proposals/by-outline/<outlineId>/index.json`.
7. Comment on issue with bundle URL + admin review URL via GitHub REST.
8. Close issue.
9. Push SSE event `bundle-created` to subscribers of every affected
   entity.

**200 response:** `{ bundleId, entityCount }`.

## Generation pipeline (outline-driven, GitHub-Action-mediated)

When Jan creates or attaches an outline to an entity, generation runs
out-of-band via GitHub. Workers can't comfortably run minute-scale Claude
calls; Actions can.

```
Cloudflare Function — POST /api/proposals/request
   ▼  creates GitHub issue (same repo, label: bot-task)
GitHub Issue (body = JSON request context)
   ▼  triggers
GitHub Action — on issue.opened with label bot-task
   - reads issue body
   - fetches entity context from Cloudflare read endpoint
   - runs Claude with outline section + guidance + entity context
   - HMAC-signed POST result back to Cloudflare
Cloudflare Function — POST /api/proposals/ingest
   - verifies HMAC
   - writes proposal to R2 in standard layout
   - comments on issue with R2 path + Jan's review URL
   - closes issue
   ▼
Standard proposal flow takes over (marker badge → Jan reviews → accept/deny)
```

Why this shape:
- **Workflow YAML *is* the prompt template.** Every prompt change is a PR
  diff with a SHA; no "what version of the prompt produced this?" mystery.
- **Issues are the natural retry surface.** Malformed Claude output =
  failed Action = open issue with logs; re-run = re-trigger.
- **GitHub provides the durable queue + audit log for free.** No
  Cloudflare Queues, no D1 job table.

### Pipeline components

**`functions/api/proposals/request.ts`** (Cloudflare)
- POST `{entityId, outlineId, sectionPath, kind}`
- Creates issue via GitHub REST `POST /repos/<owner>/milorg/issues`
- Title format (Benny-readable, English):
  `bot-task: <kind> <entityId> / outline <outlineId> §<sectionPath>`
- Labels: `bot-task`, `outline:<outlineId>`, `kind:<Person|Unit|…>`
- Body: pretty-printed JSON of the request

**`.github/workflows/bot-task.yml`** (Action)
```yaml
on:
  issues:
    types: [opened, labeled]
concurrency:
  group: claude-bot
  cancel-in-progress: false   # serialize through Claude, no parallel rate-limit hits
jobs:
  generate:
    if: contains(github.event.issue.labels.*.name, 'bot-task')
    steps:
      - parse issue body
      - fetch entity context from Cloudflare GET /api/entity/<id>/context
      - run Claude (claude-code-action or anthropic SDK step)
      - POST result to Cloudflare /api/proposals/ingest with HMAC header
```

**`functions/api/entity/[kind]/[slug]/context.ts`** (Cloudflare)
- GET `/api/entity/<kind>/<slug>/context`
- Auth: `Authorization: Bearer ${BOT_INGEST_SECRET}` (constant-time
  compare; same secret as the ingest HMAC — one rotation point).
- For `kind=Outline`, returns `{ kind, outline, referencedEntities }`:
  - `outline` — core props, descriptions with per-block `sha` (matches
    what the accept-time drift check recomputes via `stableSha`),
    plus `mentions: string[]` of `<Kind>:<slug>` ids targeted by
    `MENTIONS` edges.
  - `referencedEntities` — for every mention, the same `EntityContext`
    shape (props + descriptions+shas + outbound edges restricted to
    nodes carrying a slug + an entity-kind label). The bot uses this
    to decide `create-entity` vs `modify-block`, pick `expectedSha`,
    and resolve edge targets without inventing slugs.
- For other kinds: returns `{ kind, entity }` with the same per-entity
  shape (used for spot-checks; not part of the bot path today).

**`functions/api/proposals/ingest.ts`** (Cloudflare)
- POST `{entityId, blockPath, newValue, derivedFrom, model, generatedAt, promptHash}`
- Verifies `X-Hub-Signature-256: sha256=<hmac(secret, body)>`
- Writes per-block proposal file + updates `index.json`
- Comments on issue with R2 path
- Closes issue via GitHub REST

**Webhook auth.** Shared secret stored in GitHub Secrets +
Cloudflare env (`BOT_INGEST_SECRET`). HMAC-SHA256 over the raw request
body in `X-Hub-Signature-256`. Cheap, good enough for v1; OIDC later if
rotation becomes painful.

**Audience.** Bot-task issues are Benny-only operational noise. Jan never
sees them — he stays in the admin UI and only encounters the resulting
proposal markers. Issue titles and labels stay in English; no Norwegian
needed.

### Weekly archiver

**`.github/workflows/bot-task-archive.yml`** — weekly cron

```
1. gh issue list --label bot-task --state closed --json number,title,body,labels,createdAt,closedAt,comments
2. for each issue:
     - serialize to bot-history/<YYYY>/<MM>/<issueNumber>.json
       (body, comments, labels, timestamps, linked R2 proposal path)
     - PUT to R2 with If-None-Match: *  (never overwrite the archive)
     - on 412, the issue was already archived in a prior run → proceed to delete
     - GraphQL deleteIssue mutation
3. log summary
```

Deletion uses the GraphQL `deleteIssue` mutation (REST has no equivalent).
Requires repo admin scope on the workflow token — fine since it's Benny's
repo. The R2 archive is the durable record; GitHub is just the live queue.

### Idempotency boundaries

- Two `request` calls for the same `(entityId, outlineId, sectionPath)`
  → ingest is keyed by `<entityId>/<blockPath>`; second writer overwrites
  the first proposal file (newest wins). De-dupe at request time by
  checking for existing open issues with matching labels if the wasted
  Claude call matters.
- `ingest` POSTed twice → idempotent: same R2 path, same content.
- Archiver crash between R2 PUT and GraphQL delete → next run's
  `If-None-Match: *` returns 412, archiver detects "already archived"
  branch and proceeds to delete only.

## Denial-analysis pipeline

Every substantive denial fires off a second GitHub issue (label
`bot-deny-analysis`) that runs Claude in analysis mode — turning Jan's
free-form reasoning into a structured insight that future generation
runs can read back as negative examples and rolled-up rules.

```
Deny endpoint side-effect 9
   ▼  creates GitHub issue (label: bot-deny-analysis)
GitHub Issue
   body: { proposal, jansReason, similarPriorDenials, sourceContext }
   ▼  triggers
GitHub Action — on issue.opened with label bot-deny-analysis
   - parses issue body
   - fetches recent denials for this kind+outline from denied-corpus
   - runs Claude with analysis prompt
   - HMAC-signed POST to Cloudflare
Cloudflare Function — POST /api/proposals/denial-analysis/ingest
   - verifies HMAC
   - writes denial-analyses/<kind>/<entityId>/<ts>-<blockPath>.json
   - patches matching denied-corpus/<kind>.json entry (adds analysisRef + summary fields)
   - comments on issue, closes it
```

Same concurrency-gate, weekly-archiver, and HMAC-auth conventions as the
main generation pipeline (`bot-task` and `bot-deny-analysis` issues
serialize through the same `claude-bot` group so they don't compete for
rate-limit budget).

### Analysis output shape

```jsonc
{
  "summary":         "Bot conflated the Linge instructor course with student attendance",
  "rootCause":       "entity-confusion",
  "signalMissed":    "Source attributes 'Pulje 4 instructor' to subject; bot read it as 'Pulje 4 student'",
  "recommendation":  "When source explicitly tags 'instructor' role on a course attendance, do not generate biographical text framing the subject as a student of that course",
  "confidence":      "high",
  "model":           "claude-opus-4-7",
  "analyzedAt":      "2026-04-28T14:00:00Z"
}
```

`rootCause` controlled vocabulary (extensible):
`source-misread | temporal-error | entity-confusion | over-inference | style-mismatch | hallucination | scope-creep`.

`confidence` ∈ `high | medium | low` — lets future readers (and any rule
rollup) weight the analysis appropriately. Low-confidence analyses still
get stored but shouldn't be treated as load-bearing input.

### Analysis trigger gate

Per-denial, **conditional on `reason.length >= 40` characters**.
Trivial denials ("typo", "no") skip analysis — the value of fresh
analysis is highest when Jan's reasoning is substantive enough to
generalize from.

The gate is server-side, not UX-side; the deny form has no "skip
analysis" toggle in v1. If the gate proves too aggressive (Jan writes
short-but-meaningful reasons), lower the threshold.

### Consumption — corpus enrichment

When the analysis lands, the corresponding `denied-corpus/<kind>.json`
entry is patched in place to add:

```jsonc
{
  …existing entry fields…,
  "analysisRef":          "denial-analyses/Person/person-warberg-jan/2026-04-28T140000Z-section.biography.block.k7f3.json",
  "analysisSummary":      "Bot conflated the Linge instructor course with student attendance",
  "analysisRootCause":    "entity-confusion",
  "analysisRecommendation": "When source explicitly tags 'instructor' role on a course attendance, do not generate biographical text framing the subject as a student of that course",
  "analysisConfidence":   "high"
}
```

The analysis is denormalized into the corpus so the generator/bot don't
have to fetch a second file per denial when constructing prompts.
`analysisRef` is the canonical full-detail pointer.

### Consumption — learned-rules rollup (deferred to v2)

Periodically (monthly initially, manually-triggered) a workflow rolls
`denial-analyses/<kind>/` recommendations into a small set of stable
rules per kind, written to `.claude/learned-rules/<kind>.md` **in the
repo** (not R2):

- Repo-side keeps the rules version-controlled and reviewable as PRs —
  same logic as the workflow YAML being the prompt template.
- Manual override: Jan or Benny can directly edit
  `.claude/learned-rules/<kind>.md` to correct a wrongly-rolled-up rule
  or to add a hand-authored rule that no individual denial has yet
  triggered.
- The bot prepends `.claude/learned-rules/<kind>.md` to its system
  prompt for matching kinds.

Rollup logic is out of scope for v1 — start with raw few-shot from the
corpus and add the rollup once the corpus has enough entries for
clustering to produce meaningful groups (rule of thumb: ≥20 analyses per
kind).

### Analyses can be wrong

Because the analyzer is itself Claude reading Jan's prose, it can
misclassify or invent a recommendation Jan didn't intend. Treat
analyses as **advisory inputs to the next prompt**, never as enforced
constraints. Specifically:

- The bot's system prompt frames learned-rules as "patterns observed,
  not absolute rules" — content that contradicts a rule but is supported
  by sources is still allowed.
- Jan's deny on a future bot output is more authoritative than any
  prior analysis; if a rule is causing repeated denials, the rollup
  workflow flags it for manual review next time it runs.

## Realtime updates (SSE via Durable Object)

Per-entity Server-Sent Events stream so that multi-tab/multi-window
views of the same entity stay consistent without manual refresh, and so
bot-task and denial-analysis completions surface as toasts in real-time.

```
Admin UI (entity page) on mount:
   ▼ EventSource('/api/admin/<kind>/<slug>/events')
Cloudflare Function (the SSE endpoint, /api/admin/<kind>/<slug>/events)
   ▼ DO.fetch('/subscribe') — DO ID = idFromName(`${kind}:${slug}`)
Durable Object (one instance per entity slug)
   ▲ holds open response streams for this entity (hibernates between events)
   │
   │ pushed by:
   │
Cloudflare Functions (accept / deny / revert / ingest / denial-analysis ingest)
   ▼ on success: DO.fetch('/notify', { event, payload })
   ▼ DO writes "event: <type>\ndata: <json>\n\n" to every open stream
```

### Event vocabulary

| Event                | Payload                                                            | UI reaction                                                                       |
|----------------------|--------------------------------------------------------------------|-----------------------------------------------------------------------------------|
| `bundle-created`     | `{bundleId, outlineId, entityCount}`                               | Marker badge increments on every affected entity; bundle list views refresh        |
| `proposal-accepted`  | `{bundleId, entityId, by, message?, bundleClosed, outlineArchived}` | Multi-tab: entity card flips to accepted, marker badge decrements, live page refreshes |
| `proposal-denied`    | `{bundleId, entityId, by, reason, bundleClosed}`                   | Multi-tab: entity card flips to denied, marker badge decrements                    |
| `proposal-reverted`  | `{entityId, blockPath, by, previousSource}`                        | Block in editor refreshes to the reverted value; revert affordance disappears      |
| `analysis-ready`     | `{blockPath, summary, rootCause, confidence}`                      | Toast: "Analysis ready: <summary>" with link to view full denial-analysis         |
| `bot-task-failed`    | `{issueNumber, blockPath, errorSummary}`                           | Toast: link to GitHub issue with the failure log                                  |

### Why per-entity scoping

- Matches the access pattern: "same slug in multiple windows" is the
  exact scenario the user wants covered.
- DO instances scale linearly with entities being edited concurrently
  (one or two for single-admin today; still fine if more editors land).
- No cross-entity firehose to filter client-side, so payloads stay
  small.

### What's explicitly out of scope for v1

- **Cross-entity firehose** ("any new proposal anywhere"). List views
  and the home page rely on the existing on-load `proposals?count=true`
  fetch — navigating refreshes badges. Add a user-wide stream only if
  Jan starts complaining about stale list-view counts.
- **Presence** ("who else is editing this entity right now"). Needs
  bidirectional traffic — SSE is one-way, so revisit with WebSocket
  when soft-locking matters.
- **Manual polling fallback.** EventSource has auto-reconnect with
  exponential backoff built into the browser API. If the DO is
  unreachable the page degrades to no-realtime, but the existing
  on-load and on-route-change fetches keep it functional. Don't add a
  background 30-second poll unless the SSE proves unreliable in
  practice.

### DO + Function shape

**`functions/api/admin/[kind]/[slug]/events.ts`** — SSE endpoint
- Verifies admin session → 401 otherwise
- Forwards to the entity DO: `env.PROPOSAL_EVENTS.get(env.PROPOSAL_EVENTS.idFromName(`${kind}:${slug}`)).fetch('/subscribe', request)`
- DO responds with the `text/event-stream` response that the browser's
  EventSource consumes

**`PROPOSAL_EVENTS` Durable Object class**
- `fetch('/subscribe', req)` — opens a `ReadableStream`, holds the
  controller in its in-memory subscriber set, returns the SSE response.
  Uses Cloudflare's hibernating DO API so the DO can sleep between
  events.
- `fetch('/notify', req)` — JSON body `{event, payload}`. Writes
  `event: <event>\ndata: <JSON.stringify(payload)>\n\n` to every
  subscriber's controller. Drops controllers that error (closed tabs).
- No persistence on the DO — subscriber set is in-memory only. Events
  are not replayed on reconnect; the EventSource just resumes and the
  on-load fetch reconciles state.

Mutation endpoints (`accept`, `deny`, `revert`, `ingest`,
`denial-analysis/ingest`) all add a final fire-and-forget step:
`env.PROPOSAL_EVENTS.get(...).fetch('/notify', { method: 'POST', body: JSON.stringify({event, payload}) })`.
Failure to notify never fails the request — the mutation is already
durable in R2 + Neo4j; the SSE push is best-effort.

## Components to build

### 1. Sanity-side generator (`scripts/proposals/generate.ts`)

For Sanity-driven proposals (the non-outline path — when Sanity content
changes upstream), a local script Benny invokes:

- Reads Sanity (existing helpers in `src/composables/useLocationCache.ts`,
  `src/config/sanity.ts`) and current Neo4j state
- Maps each Sanity entity to schema v1 PT shape (see
  `docs/NEO4J-MAPPING.md`)
- For each PT block, applies the drift 2×2:
  - untouched both sides → skip
  - upstream-only change → emit auto-propose proposal
  - local-only change → skip (leave Jan's edit alone)
  - both-sides changed → emit conflict proposal
- Skips blocks suppressed by `denied/` archive
- Writes per-block files + `index.json` to R2 directly (no GitHub round-trip
  — there's no Claude inference step here, just mechanical mapping)
- Idempotent: re-running with no Sanity changes produces no new files

Outline-driven proposals go through the GitHub Action pipeline above
instead.

### 2. Read endpoints

- `GET /api/admin/<kind>/<slug>/proposals` — open bundles touching this
  entity. Used by the marker-badge composable + entity-page proposal list.
- `GET /api/admin/proposals/<bundleId>` — full bundle (manifest + every
  per-entity payload). Used by the bundle review page and the
  proposal-preview composable.

Both admin-session-gated. v1 limitation: drift recomputation per
`modify-block` op is deferred until the Description+block lookup
helper exists. v1 returns proposals as-is; drift is detected at
accept time (409 with drifted block paths in the response).

### 3. Accept / Deny / Revert endpoints

Per the API contract above. The accept endpoint is the most complex —
it runs a single Neo4j transaction over all the entity's ops, drops
edges to denied targets, stamps `previous*` for `modify-block`, and
auto-archives the outline if the bundle is fully resolved. v1 covers
the `create-entity`, `modify-block`, and `add-edge` ops (the other
three op types — `remove-edge`, `delete-entity`, `obsolete-outline` —
arrive later as the bot's prompt expands to emit them).

### 4. `useProposalEntityData(bundleId, entityId)` composable

The polymorphic preview composable that:
- Fetches the bundle's manifest and the entity's payload
- Internally dispatches by entity kind to apply ops on top of the live
  per-kind composable's data (`usePersonData`, `useUnitData`, etc.)
- Returns the same reactive shape as the matching live composable,
  plus a `_proposal` sidecar carrying status + ops + conflicts
- Tags every edge with `targetExists` / `pendingFromBundle` for
  ghost-styling decisions in the view

### 5. Edge ghost-state styling

Existing edge components (chips, lists) get a `ghost` class binding
keyed on `!edge.targetExists`. Style: dashed border + desaturated
fill + click-through routes to
`/proposals/<bundleId>/preview/<targetEntityId>` instead of the live
detail page.

### 6. Composable extractions for kinds not yet controller-view clean

Per the audit:
- **`useIncidentData(slug)`** — lift the inline `authFetch` calls in
  `EventDetail.vue` into a composable mirroring the others. Required
  before the proposal-preview architecture works for Events / Incidents.
- **`useOutlineData(slug)`** — small composable returning one outline's
  body + edges; wraps `useLocationCache` for live reads, hits a
  per-outline endpoint when needed.

After these two, all 7 detail pages consume composables and the
preview architecture is universal across the entity kinds Jan touches.

Location remains without a standalone detail page; treat as deferred
until a real proposal needs to preview a Location.

### 7. Bundle review page + per-entity preview routes

- `/proposals` — list all open bundles
- `/proposals/<bundleId>` — bundle review page (manifest entity list +
  navigate-to-preview per entity)
- `/proposals/<bundleId>/preview/<entityId>` — render the entity's
  detail component with `useProposalEntityData` instead of the live
  composable. Wraps with proposal-review chrome (status badge,
  accept/deny buttons, conflict warnings)

### 8. Admin entry points (marker badges)

Marker-badge composable `useProposals(entityId)`:
- Fetches `/api/admin/<kind>/<slug>/proposals?count=true`
- Exposes `pendingCount` ref
- Subscribed to SSE stream for `bundle-created` / `proposal-accepted` /
  `proposal-denied` events to keep the badge live

Mounted on:
- `ItemCard` (list views, map markers)
- Detail page headers (each kind's detail page already has a header
  slot for status/badges)

### 9. Per-block revert affordance (independent of proposals)

Whenever a block has non-null `previousValue`, `SectionsEditor` renders
a small "↶ Revert to <previousSource> from <previousAt>" link. One
click → POST to `revert` → block returns to prior value, affordance
disappears. Independent of the bundle flow; works for blocks with no
associated proposal (e.g., reverting a manual edit Jan made by mistake).

### 10. Janitor (deferred, not v1)

A `scripts/proposals/sweep.ts` that:
- Finds `accepted/<entityId>-<ts>.json` entries with no corresponding
  manifest update (failed apply between intent-write and manifest patch)
  → retry the apply transaction (idempotent — most ops are MERGE-safe).
- Finds bundles in R2 with no remaining pending entities → close them
  + auto-archive outlines if applicable + remove from
  `by-entity` / `by-outline` indices.
- Probably runs on a Cloudflare cron.

## Build phases

The phases assume the bundle model + entity-as-review-unit + preview
via composable swap. Sanity-drift use-cases (mostly-PT block updates
from upstream) still slot in at phase 8 as an alternate generator path
that emits single-op `modify-block` bundles.

1. **Provenance + revert plumbing in Neo4j.** Add `sanityId`,
   `sanityRev`, `sanityImportedAt`, `sanitySha` and `previous*`
   properties to the PT block shape. Wire history-log appending into
   existing admin write paths. No proposals yet — just make the
   plumbing exist and survive normal editing.

2. **Outline as first-class node + notebook view.** Import outlines as
   `:Outline` nodes per `docs/SCHEMA.md`. Add `/outline/<slug>` route,
   backlinks panel showing entities deriving from this outline.

3. **Bundle ingest + read endpoints, no UI yet.** Wire
   `functions/api/proposals/request.ts` (DONE), `bot-task.yml`
   workflow (DONE), `functions/api/proposals/ingest.ts` (DONE upgraded
   to bundle shape), `functions/api/admin/<kind>/<slug>/proposals.ts`
   read endpoint (DONE upgraded). End state: a bot-generated bundle
   lands in R2 and can be inspected via curl. Manual hand-verification.

4. **Composable extractions for non-controller-view pages.** Extract
   `useIncidentData(slug)` (lift inline fetches in `EventDetail.vue`)
   and `useOutlineData(slug)` (per-outline). After this, all 7 detail
   pages consume composables and the preview architecture is universal
   across kinds Jan edits.

5. **`useProposalEntityData` composable + edge ghost-state styling.**
   The polymorphic preview composable + the `ghost` class binding on
   edge components. End state: feed `useProposalEntityData(bundleId,
   entityId)` to a detail page programmatically and see it render the
   pending state with ghost edges.

6. **Bundle review page + per-entity preview routes + accept/deny.**
   `/proposals` list, `/proposals/<bundleId>` review page,
   `/proposals/<bundleId>/preview/<entityId>` route, accept/deny
   endpoints. End state: Jan can review and decide on real bot output.

7. **Marker badges everywhere + entity-context fetch endpoint for the
   bot.** Marker badges on ItemCards / map markers / detail page
   headers. `GET /api/entity/<kind>/<slug>/context` (✅ landed —
   `functions/api/entity/[kind]/[slug]/context.ts`) for the bot to
   fetch real entity context (replaces the workflow's stubbed
   placeholder). Now bot output quality jumps because Claude has the
   live entity state to ground its proposals.

8. **Sanity-side generator (single-op `modify-block` bundles).**
   `scripts/proposals/generate.ts` for the Sanity-drift use case —
   emits one-op bundles (no Claude inference). Uses the same R2
   layout + accept/deny pipeline. Skips blocks suppressed by the
   denied corpus.

9. **Denied-proposal corpus + suppression on re-run.** Deny endpoint
   writes the corpus shard. Sanity-side generator + bot prompt both
   consult it before emitting. Bot prompt includes top-N similar
   denials as few-shot negative examples.

10. **Denial-analysis pipeline.** Substantive entity-level denials
    fire `bot-deny-analysis` issues. Analyses patch back into the
    corpus entry. No learned-rules rollup yet (v2).

11. **Weekly archiver.** Closed `bot-task` + `bot-deny-analysis`
    issues → R2 (`bot-history/<YYYY>/<MM>/<issueNumber>.json`) →
    deleted from GitHub. Keeps the issue list bounded.

12. **Realtime updates (SSE via Durable Object).** Per-entity SSE
    stream; mutations + ingests push events; admin UI consumes via
    EventSource. Multi-tab consistency + analysis-ready toasts. Up to
    this phase, the UI worked off on-load fetches alone.

13. **Conflict proposals + reconciliation UI.** The
    both-sides-changed case from the drift 2×2 (Sanity-side
    generator). UI surfaces conflicts with side-by-side reconcile.

14. **Janitor + learned-rules rollup + remaining op types.**
    `remove-edge`, `delete-entity`, `obsolete-outline` ops. Janitor
    sweep for half-applied accepts / orphan bundles. Learned-rules
    monthly rollup once corpus has ≥20 analyses per kind.

15. **Roll out: which entity kinds are ready when.** After phase 6,
    proposal-preview works for: **Person, Unit, Organization, Station,
    Transport** (already controller-view clean). After phase 4: also
    **Incident, Outline**. Location: deferred (no standalone detail
    page yet; revisit when a proposal needs to preview a Location).

## Open questions before phase 1

- **History log retention.** Keep forever, or trim by age / by entity?
  Lean: forever for v1, disk is cheap; revisit if it ever costs
  something.
- **Message UI.** Free-form text only, or structured tags (`"editorial
  inference"`, `"source: AIR 27"`, etc.)? Lean: free-form for now;
  structured tags are an easy follow-up.
- **Outline editability.** Read-only after import, or editable through
  admin (recursive proposal flow)? Lean: editable, since Jan creating
  new outlines is the whole point — this affects how outline-versioning
  flows through to derived proposals.
- **Outline-to-entity attachment model.** Manual `(Entity)-[:USES_OUTLINE]
  ->(Outline)` edges only, or selector-based (`{kind, filter}`) auto-
  attach? Lean: manual for v1, selector later — a bad selector floods the
  proposal queue.
