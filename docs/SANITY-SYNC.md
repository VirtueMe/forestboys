# Sanity sync — the bridge to cutover

How the graph keeps up with Sanity until Jan stops editing there. Draft
for review — nothing here is built yet except the sync report
(`scripts/sanity/sanity-sync.ts`). Extends `PROPOSALS.md`, which covers the
review flow; this document covers what a sync decides before anything
reaches review.

---

## Why

Sanity is still where Jan edits most content, and it has moved on since
the graph was imported in April. The sync report on 2026-09-27:

| Sanity type | In Sanity | In graph | New | Changed | Deleted |
|---|---:|---:|---:|---:|---:|
| person | 3 956 | 3 791 | 172 | 349 | 7 |
| event | 2 281 | 2 196 | 105 | 381 | 20 |
| transport | 1 058 | 998 | 61 | 8 | 1 |
| location | 1 161 | 1 105 | 56 | 12 | 0 |
| station | 146 | 136 | 10 | 31 | 0 |
| organization | 25 | 22 | 2 | 0 | 0 |
| district | 42 | 42 | 1 | 0 | 0 |
| outline | 31 | 30 | 1 | ? | 0 |

The graph is not a copy of Sanity, though. Import rules reshaped some
data (a Sanity organization became a Unit, outlines were split into
Operations and Persons), and Jan has edited in the graph since. A naive
re-import would undo that; not syncing leaves the graph behind.

---

## Principles

- **Sanity is the authority** for every document it holds — until
  cutover.
- **This is a bridge, not permanent infrastructure.** When Jan judges
  the application mature enough, he stops editing Sanity; one final
  sync runs and the bridge is retired (see *Cutover*). Everything here
  is sized for that: as little new machinery as possible.
- **An unchanged source keeps its old import.** A Sanity change is only
  looked at when it touches something the graph took from Sanity.
- **Graph edits are never silently overwritten.** A field changed on both
  sides goes to review.

Content created in the graph with no Sanity source (Roles, stays entered
by Jan, entities from the create flow) is graph-authoritative and
outside this document.

---

## Baseline

`data/sanity-baseline-2026-04/` holds the Sanity export the graph was
built from (taken 2026-04-26, preserved 2026-09-27; `data/` is
gitignored, so this copy is local — keep a backup).

It is the record of **what the graph took in**, which is what
per-document mapping records would otherwise have to store. For each
document, the baseline is trustworthy when its `_updatedAt` equals the
node's `sanityUpdatedAt`:

| | Documents |
|---|---:|
| Baseline matches the import | 8 145 |
| Edited in Sanity between the import (15 Apr) and the export (26 Apr) — 65 event, 53 person, 17 station | 135 |
| Outlines — no `sanityUpdatedAt` on the node | 30 |
| Organization with graph timestamp newer than the export | 1 |

For the 166 without a trustworthy baseline, every difference between
Sanity and the graph goes to review.

### Fields imported after April

A field imported later has no April baseline. Its import stamps the
imported value's hash on the node instead, next to the existing per-field
provenance (`<field>_sourceRef`, `<field>_state`):
`<field>_sanityUpdatedAt` and `<field>_sha` (sha256 of the value as stable
JSON, `scripts/lib/sanity-sha.ts`). The three-way compare then uses the
stamp as the baseline: Sanity changed the field when its value no longer
hashes to the stamp, the graph was edited when the stored value no longer
does.

- **Person descriptions** — never imported with the rest (the Person page
  showed them from the Sanity cache). Imported 2026-09-27 by
  `scripts/sync/import-person-descriptions.ts`: 3 462 people, one section each,
  `description_state: 'candidate'`. 163 people with descriptions are not
  in the graph yet; the new-person import must bring theirs along.

---

## Sync

Run per Sanity type. `(:SyncState {source: 'sanity', type, importedUpTo})`
holds Sanity's own `_updatedAt` of the newest change taken in; it only
narrows which documents to look at.

1. Fetch documents with `_updatedAt >= importedUpTo` from `api.sanity.io`
   (not the CDN, which can lag), plus the full `_id` list for deletions.
   `scripts/sanity/sanity-sync.ts` does this today and writes a report.
2. For each changed document, compare field by field, three ways —
   **baseline** value, **current Sanity** value, **graph** value (what
   the import rule makes of the field):

| Baseline → Sanity | Graph vs. baseline | Action |
|---|---|---|
| unchanged | — | Nothing. |
| changed | graph still equals the import of the baseline | Apply the Sanity change. |
| changed | graph was edited | Conflict → review bundle with all three values. |
| field the import never reads | — | Nothing. |

3. New documents: run the type's import rule, apply directly (the rule
   may send doubtful cases to review — e.g. an event that could be an
   Incident or an Operation).
4. Deleted documents: listed with what deleting them would do, applied
   only when named (`--accept-delete=<slug>,…` for people,
   `scripts/lib/person-deletions.ts`). Most are Jan merging a duplicate:
   where the deleted person was, the Sanity event now names the survivor,
   so the event edge moves there. Other edges the import made go with the
   person; anything entered in the graph (stays, rank history, notes,
   editor-marked links, mentions in other descriptions) blocks it.
5. After applying, the applied Sanity version becomes the new baseline
   for that document, and `importedUpTo` advances **in the same
   transaction as the writes**, so a fetched-but-not-applied change is
   fetched again next time. Documents waiting in review don't hold the
   marker back; they are skipped until resolved.

"Graph was edited" is decided by comparison, not by tracking every save:
the graph value differs from what the import rule produces from the
baseline. That keeps the editors untouched.

### The rule, ported

The person import rule lives in the Clojure migration (`migration/src/linge/`).
The sync uses a TypeScript port, `scripts/lib/person-rule.ts`, so the sync
tooling stays in one language. Calibration holds the port to the original:
applied to the April baseline it must reproduce the graph for every
unchanged person — canonical name, rank edge, status, serviceClass, link
and image Source ids. It did, 100 % over 3 435 people.
`scripts/sync/sync-person.ts` refuses to write when it doesn't.

### Stamps

When a field is applied (or imported after April), the Person gets
`<field>_sha` — hash of the Sanity value taken in — and, where the rule
reshapes it (name → canonicalName), `<field>_graphSha` — hash of what the
graph got. From then on that stamp is the field's baseline, not the April
export. `scripts/lib/person-sync.ts` holds the comparison for both the
report and the apply step.

### Slugs

Slug changes follow Sanity. The graph app isn't live, while the live site
already uses Sanity's slugs, and Jan reuses freed slugs (the Reidulf Larsen
split: the old person became `reidulf-larsen-wt`, a new one took
`reidulf-larsen`). Renames run first, in one transaction, via temporary
slugs; description ids follow the slug.

### Review — no baseline

Some people were imported from a Sanity state older than the April export
(the node's `sanityUpdatedAt` predates it), so there is no baseline and a
changed field can't be told apart from a graph edit. These go to review.

`--accept-review=<slug>,…` applies Sanity's value for the named people as
if clean — the judgement that the graph holds no edits of its own beyond
what can be detected. What can be detected still blocks the field:

- name, cover name, home or birth year saved in the person editor — the
  save marks the field `<field>_sourceRef: 'admin-edit'`,
  `<field>_state: 'verified'` (`unknown` when cleared), and a marked field
  without baseline is a conflict, not review. Saves before 2026-10-02 carry
  no marker;
- the person type (civilian / soldier), which otherwise follows the known
  rank — a parsed or editor-set rank makes a soldier, the Menig default a
  civilian — unless chosen in the editor (`type_sourceRef: 'admin-edit'`);
- gallery edges with editor props;
- graph links Sanity doesn't have (links added with `sourceRef: 'admin-edit'` are a conflict, not review).

Accepted on 2026-09-29 (graph slugs before the run; all 37 were checked
side by side, and the graph values were older Sanity states, never edits):

```
aksel-edvin-larsen,bjarne-iversen,claus-urbye-helberg,erling-jensen,harald-svindseth,henning-kofoed,ivar-naess,kjell-engelsen,knut-aarsaether,konrad-anker-hennum,lars-dalland,nils-eliassen-fjeld,ole-baarnes,per-blindheim,ragnar-ulstein,arvid-fossum,knut-mostue,finn-scheldrup-johansen,harald-storvik,peter-graben,nils-kristoffer-o-torsvik,sissel,johan-p-bjelland-thu,johan-hagemann,bjorn-norderhaug,frick,tor-jorgen-falkevik,o-berentsen,hugo-munthe-kaas,golda-goldstein,torvald-olai-lien,per-andreas-larsen,paul-magnussen-strande,ole-berg-lt
```

Accepted on 2026-10-02: `na` → `n-a`, name "-NA-" → "N/A". A deliberate
placeholder — the description reads "Unknown pilot" (Tirpitz 14).

Accepted on 2026-10-02, answered from their descriptions:

- `kare-helland` — "Kåre Hellan" is right (no.wikipedia.org/wiki/Grebe,
  now a source on the person). Løytnant, "Y.3", Trondheim and the
  three-image gallery as Sanity has them. Rank history entered from the
  description: Sersjant 1940-04-09 → Fenrik 1943-11-01 → Løytnant
  1944-11-01.
- `2lt-polansky-henry-l` → `s-lt-polansky-henry-l` — the description reads
  "Rank: Second Lieutenant" (USAAF, 492nd BG). Jan's "S/Lt" here means
  Second Lieutenant, while the rule maps S/Lt to Sub Lieutenant (navy), so
  the known rank is set as an editor save (`admin-edit`) before the accept;
  the sync keeps it. Order mattered: `scripts/migrations/migrate-rank-table.ts` had
  already stripped "2Lt" from the graph name, so the name compared equal
  and the sync skipped the ✝ status — set by hand with the name stamp.

None held.

S/Lt means two ranks in Sanity, told apart by position: American airmen
are written rank-first, "S/Lt. Davis Jere L" — Second Lieutenant (USAAF);
Norwegians rank-last, "Jan Helen S/Lt" — Sub Lieutenant (navy). The rule
reads it that way since 2026-10-02 (`LEADING_ABBR_TO_RANK` in
person-rule.ts, `leading-abbr->canonical` in parse.clj), and "S/Lt." with
a period is parsed too. `scripts/migrations/migrate-rank-table.ts` re-mapped the 9
people the change touched.

The exception: "S/Lt Ferner" is rank-first because the name comes from a
333 Squadron crew list (AIR 27), not Jan's American style. He is Finn
Christian Ferner, Fenrik 1945 (scramble.no, *Luftforsvaret
personellfortegnelse pr. 1. juni 1945*). Fenrik and Second Lieutenant
share tier 4, so only the label is off. Waiting for Jan to rename him in
Sanity (e.g. "Finn Christian Ferner Fenrik"); the sync then takes it in.

### Where it has run

The scripts use `.env`, which is the **local** Neo4j. Production Aura
(`.env.production`) has had none of this. Status on 2026-10-02, local only:

| Step | Script | Result |
|---|---|---|
| Stationed roles | `scripts/seed/seed-roles.ts` | 5 roles |
| Person descriptions | `scripts/sync/import-person-descriptions.ts --write` | 3 462 |
| Person sync | `scripts/sync/sync-person.ts --write` | 259 changed (20 slug renames), 173 new; 37 left for review |
| Rank split | `scripts/migrations/migrate-rank-split.ts --write` | 3 964 `RANK` edges; 1 history entry (PERSON-RANKS.md) |
| Person sync | `scripts/sync/sync-person.ts --write` | 3 changed |
| Person sync, review | `scripts/sync/sync-person.ts --write --accept-review=…` (list above) | 34 changed (5 slug renames); 3 held |
| Person sync, review | `scripts/sync/sync-person.ts --write --accept-review=na` (2026-10-02) | 1 changed (1 slug rename); 2 held |
| Person sync, review | `scripts/sync/sync-person.ts --write --accept-review=kare-helland` (2026-10-02) | 1 changed |
| Rank table | `scripts/migrations/migrate-rank-table.ts --write` (2026-10-02) | Second Lieutenant (USAAF); 2 people: Prilliman, Polansky |
| Person sync, review | `scripts/sync/sync-person.ts --write --accept-review=2lt-polansky-henry-l` (2026-10-02, after his rank was set in the editor) | 1 changed (1 slug rename); 0 held |
| Rank table | `scripts/migrations/migrate-rank-table.ts --write` (2026-10-02, S/Lt by position) | 9 people: 7 Second Lieutenant, 2 Sub Lieutenant |
| Person sync, deleted | `scripts/sync/sync-person.ts --write --accept-delete=…` (2026-10-02, all 7) | 7 deleted; 5 event edges moved to the survivor (Aksdal ×3, Øygard, Vestrheim) |
| Events → Operation | `scripts/migrations/migrate-events-to-operation.ts --write` (2026-10-02) | 2 195 Incidents → Operation; 7 974 PARTICIPATED_IN |
| Missing references | `scripts/sync/import-missing-refs.ts --write` (2026-10-02) | 51 Location, 2 Station, 58 Transport |
| Event re-import | `scripts/sync/reimport-events.ts --write` (2026-10-02) | 2 196 deleted, 2 279 Operations, 8 graph additions re-attached; new baseline |
| Event sync, first run | `scripts/sync/sync-event.ts --write` (2026-10-02) | 2 279 events stamped; 0 changes |
| Rank table, type | `scripts/migrations/migrate-rank-table.ts --write` (2026-10-02) | 18 people civilian → soldier (ranks set by sync, rank table or editor without the type) |

Production: the Aura Free instance (`f8cb9726`) was deleted for
inactivity — Aura Free needs regular writes. A new instance is loaded from
a dump of the local graph (`data/dumps/neo4j.dump`, 2026-10-02: 23 676
nodes, 45 852 relationships), which already holds every step above, so the
steps aren't replayed there.

Scripts reach production only with `--production` (`scripts/lib/env.ts`):
it reads `.env.production` and connects with `PRODUCTION_NEO4J_URI`,
`PRODUCTION_NEO4J_USERNAME`, `PRODUCTION_NEO4J_PASSWORD` (environment
variables win — the CI secrets use the same names), printing the target
first. The new instance is `ad896296`. Without it they read `.env` and refuse a NEO4J_URI that
isn't localhost. Writing still needs `--write`. A daily job running
`sync-person.ts` and `sync-event.ts` with `--production --write` keeps
Jan's edits flowing in and the instance alive (both write
`SyncState.at`).

CI has no `data/`, so it has no baseline files (24 MB, local only): a
document's baseline is its stamps on the node. `sync-person.ts --stamp` and
`sync-event.ts --stamp` write them once from the local baseline files — a dry
run by default, `--write` to stamp, nothing else changes, and they refuse
unless every document gets from its stamps the verdicts the file gives, and
`--write` first saves `data/sanity-delta/<person|event>-stamp-undo-<time>.json`:
per node, exactly the keys it adds (a map of nulls) and the Cypher that removes
them (`SET p += x.remove` over the file's `rows`) — some nodes already carry
stamps from earlier applies, so the undo cannot be "remove every `_sha`". A
document with neither a stamp nor a trustworthy baseline has no baseline and
goes to review, never to an automatic apply. Without the file the person
calibration is skipped (it compares the rule with the baseline, so it stays a
dev-time check: run `scripts/sanity/sanity-person-fields.ts` after a rule
change). Each run keeps its plans and undo snapshots as a workflow artifact
(30 days), and «Run workflow» with *write* unticked is a dry run against
production.

### Events

A Sanity event is closest to an **Operation**: organization, from/to
locations and stations map one-to-one (`ORCHESTRATED_BY`, `FROM`/`TO`,
`FROM_STATION`/`TO_STATION`), people become `PARTICIPATED_IN`. An Incident
is a reshaping — one place, no organisation of its own — so it is
proposed, never applied by the sync.

- 2026-10-02: every Sanity event in the graph became an Operation
  (`scripts/migrations/migrate-events-to-operation.ts`, local: 2 195 flipped, 7 974
  person edges kept with their properties). The flip is the shared rewrite
  in `functions/_lib/event-kind.ts`, also used by the kind endpoint.
- New events come in as Operations; changed fields apply to the node with
  that `sanityId`, whatever its label.
- Classification proposes Operation → Incident per event as a bundle;
  accepting it demotes (and drops `ORCHESTRATED_BY`).

Bundles can come from the sync (`origin: {type: 'sanity'}`) and carry
`set-props` and `set-kind` (PROPOSALS.md, "Bundle origin").

**Re-import, 2026-10-02.** The field report (`scripts/sanity/sanity-event-fields.ts`)
showed the graph's events still matched the April import on every field
but one — and Sanity had moved on: 379 changed, 104 new (31 of them Jan's
new "WT Station …" events), 20 deleted. Syncing that event by event would
have been slower than taking Sanity in again, so:

1. `scripts/sync/import-missing-refs.ts --write` — the 51 Locations, 2 Stations
   and 58 Transports events refer to that were new in Sanity since April
   (round_one.clj's rule). The organizations "Avd D. Mi IV" and "COHQ" and
   the district "D41-Finnmark" are shaped by hand and left for that.
2. `scripts/sync/reimport-events.ts --write` — backup, delete the 2 196 events,
   create 2 279 Operations from Sanity (the WT station template
   `wt-stationmal` excluded: `EXCLUDED_EVENT_SLUGS`), re-attach the 8 graph
   additions (Martin Linge's editor links and note, the Haslund pair on
   Gulltransporten, `AT hovann`). Martin Linge's link to "Første møte om
   motstandsbevegelse i London", lost in a relation-editor save, is back.
3. The Sanity events taken in are the new baseline:
   `data/sanity-baseline-2026-10/sanity-event.json` (`EVENT_BASELINE`). The
   field report then shows 0 changed, 0 new, 0 deleted, every field agreeing
   but the three hand-shaped references.

For Jan: location "Sander - Skarnes bro" has the slug `60.2314300 ` and
lat = lng = 11.81378; transport "Handley Page Halifax II" has no serial
(slug `handley-page-halifax-ii-`).

**Sync** — `scripts/sync/sync-event.ts`, a plain bridge like the person sync;
judgement (Incident candidates, trips under their named operation,
incidents in descriptions) is left to separate analysis jobs that propose
bundles.

- Every event carries field stamps (`<field>_sha`, `scripts/lib/event-sync.ts`):
  the value last taken in from Sanity. The first run stamped all 2 279
  from the baseline file; from then on the graph holds its own baseline.
- Per field Sanity changed: `clean` (graph still at the stamp) is applied
  with the import's rule (`scripts/lib/event-rule.ts`, shared with the
  re-import), `already` only moves the stamp, `conflict` (graph edited too)
  is left and listed.
- Descriptions are compared, stamped and saved with their AIR 27 references
  made links to the National Archives search (`eventDescription()` in
  `event-rule.ts`, `linkArchiveBlocks()` in `src/utils/archiveRefs.ts`, #106).
  `AIR-27-2159-22 p24` becomes a span with an ordinary `link` mark; the page
  stays text, `_2` and `+24` are linked but not searched for, and spans that
  are already links or people are left alone. The links are never Sanity's, so
  they are not a graph edit: the stamp is the hash of the linked text, and a
  later Sanity edit is `clean`. The first run after the change takes them into
  every description that has a reference (718 on 2026-10-05) as an ordinary
  `clean` change. Only AIR 27 — the HS series are left alone (Jan).
- People compare on the import's links only — editor additions
  (`sourceRef: admin-edit`) stay and don't count as a graph edit; removing
  an imported link does. Links to targets the graph doesn't have yet are
  left out of the comparison, so they arrive as an ordinary change later.
- New events are created as Operations; deleted ones need
  `--accept-delete=<slug>,…` and are blocked by graph additions.
- **A description edited in the graph is rewritten from Sanity** (#119). Until the cutover Sanity
  is the master, and Jan tries the editor in the live graph (`ax-32`, 2026-10-06). One test edit
  of one description used to fail calibration and so block the whole event sync. Now a
  description that differs from Sanity is a `reset` verdict, whatever its stamp says (Sanity
  unchanged, Sanity changed, no baseline): it is rewritten with the import's rule like a
  `clean` change, stamped, and listed in the dry run and the report
  (`↺ <slug>: description`, `rewritten` in the plan file). The text it replaces is in the
  backup (`event-before-<time>.json`, and the run artifact for 30 days). Calibration does not
  count these edits. It is the event `description` only (`RESET_FROM_SANITY` in
  `scripts/lib/event-sync.ts`): every other field keeps `conflict` and the calibration check, and
  the other types' descriptions keep the `conflict` rule of `sync-description.ts`.
  **Temporary:** at the cutover the graph becomes the authority — empty `RESET_FROM_SANITY` so
  the graph's edits count again. `--keep-graph-edits` switches it off for one run.
- Refuses to write unless calibration is 100%; backs up touched events first.

### Descriptions of transports, stations and locations

Their descriptions were never imported (#99); the pages showed none. One sync
carries them, and keeps carrying Jan's edits, for the types listed in `KINDS`
(`scripts/lib/description-sync.ts`): **transports**, **stations** and **locations**. Only the description: their links are already `:Source` nodes
(`(owner)-[:REFERENCED_IN]->(:Source)`, the same shape for every type) and the
sync does not touch them.

`npx tsx scripts/sync/sync-description.ts --type=transport|all [--write]` (a dry
run unless `--write`; the daily job runs `--type=all`). Per node:

```
(n)-[:HAS_CONTENT]->(Description {id: 'desc:<kind>:<slug>:1', order: 1, content})
```

the shape the editor writes (`functions/api/admin/<kind>/[slug]/sections.ts`) and
the person import wrote. `content` is Sanity's Portable Text with its AIR 27
references made links (`linkArchiveBlocks`, #106), so a description is stored
the same way for every type. The stamp sits on the parent node, as for people:
`description_sha` (the hash of that value as last taken in), with
`description_sourceRef`, `description_state: 'candidate'` and
`description_sanityUpdatedAt`.

| Verdict | When | What happens |
|---|---|---|
| unchanged | Sanity has not changed since the stamp, or neither side has text | nothing |
| new | no stamp, nothing in the graph, text in Sanity | imported |
| clean | Sanity changed, the graph still holds the stamped text | applied |
| already | Sanity changed, the graph already holds the new text | only the stamp moves |
| conflict | Sanity changed and the graph text was edited (or taken away) | left alone, listed |
| review | no stamp, and the graph has text of its own | left alone, listed |

Graph text is never overwritten: only `new` and `clean` write, and a Description
that is already there keeps its node, id and edges (an editor's citations stay) —
only its text changes. An edit in the
editor (which replaces the Description and leaves the stamp) is not a conflict
until Sanity changes the same description. Before writing, the nodes it will
change are saved to `data/sanity-delta/description-before-<type>-<time>.json`;
`SyncState {type: '<kind>-description'}` records the run.

### Transports — their own fields

`name`, `type`, `unit` and `regser` were imported once (April, and
`import-missing-refs.ts` for the new ones) and never again (#112). One sync
carries them: `npx tsx scripts/sync/sync-transport.ts [--write]
[--accept-review=<slug>,…]` (a dry run unless `--write`; the daily job runs it
before the event sync, so a new transport has its node when an event links it).
`reserve` is not synced.

Where the graph keeps each field:

| Sanity | Graph |
|---|---|
| `name` | `canonicalName` |
| `type` | `type` (+ `type_state`, `type_sourceRef`) |
| `regser` | `regser` (+ `regser_state`, `regser_sourceRef`) |
| `unit` | `rawUnit` (+ `rawUnit_state`, `rawUnit_sourceRef`) |

The import stores the unit as `rawUnit`; the transport editor writes `unit`
(`functions/api/admin/transport/[slug]`). Where a node has `unit`, that is its
value: the page and the lists read `coalesce(unit, rawUnit)`, and the sync treats
it as a graph edit. When the sync applies Sanity's unit it writes `rawUnit` and
removes `unit`.

**Whitespace.** Sanity values carry stray whitespace (`regser` is `" 42-7612"`,
names have runs of spaces and tabs). Values are compared tidied (trimmed, runs of
whitespace collapsed to one space; `src/utils/tidyText.ts`), the graph gets the
tidied value, and the stamp is the hash of it. A value that differs only in
whitespace is therefore `already` — and is rewritten tidied. Slugs are not
touched (#96, #115).

Stamps: `<field>_sha` per field on the node (`name_sha`, `type_sha`, `unit_sha`,
`regser_sha`), the hash of the tidied Sanity value last taken in. Per field:

| Verdict | When | What happens |
|---|---|---|
| unchanged | Sanity still holds what the stamp says | nothing |
| clean | Sanity changed, the graph still holds the stamped value | applied |
| already | the graph already holds Sanity's value (also the first run, with no stamp) | the stamp moves; the value is rewritten only to tidy it |
| conflict | Sanity changed and the graph value was edited | left alone, listed |
| kept | no stamp, Sanity unchanged since the import, the graph differs | the graph edit stays, the stamp moves |
| review | no stamp, Sanity changed since the import, the graph differs | left alone, listed; `--accept-review=<slug>` applies Sanity's |

Without a stamp there is no baseline for a field: the export is not kept for
transports, and the editor does not mark its edits. `sanityUpdatedAt` stands in
for it — it tells whether Sanity changed since the import — and so it does not
move on a node that still has a field held for review. A name that is empty in
Sanity is never applied.

New transports (a Sanity document with no node) are created with the import's
rule, tidied and stamped; a slug already taken is an error. Nodes with no Sanity
document are listed. Before writing, the nodes it will change are saved to
`data/sanity-delta/transport-before-<time>.json`; `SyncState {type: 'transport'}`
records the run.

First dry run (2026-10-06, local copy of production): 1,058 in Sanity, 1,056 in
the graph; 3 new; every stamp-less field is `already` except 5 fields on 4
transports that go to review — the unit of the Nona Rhea
(`ford-liberator-b-24h-1-fo-42-7612`) among them.

### Reshaped documents — curated mappings

Where the import did more than copy fields, the three-way compare has
nothing to compare against. These get a **curated mapping**: a small
record of what the import did and which Sanity fields it read.

```
(:Mapping {
  sanityId, sanityType,
  inputs:  '{"people":"9c02…"}',   // sha per Sanity field it read
  ops:     '<bundle ops, PROPOSALS.md format>',
  state:   'active' | 'stale'
})-[:PRODUCED]->(node / edge owner)
```

If an input field changes, the mapping goes `stale` and a review bundle
proposes a new one; until then the old one stands. Known cases:

- Kompani Linge — Sanity organization → `Unit`
- Outlines absorbed into Operations / Persons: the nodes we made from outlines before the bundle pipeline are
  converted into bundles Jan accepts (#158, `BUNDLE-FORMAT.md`, *Earlier absorptions*); after that no node is a
  reshaping nobody reviewed, and what an absorption makes is a bundle (`PROPOSALS.md`)
- `location.people[]` / `station.people[]` → STATIONED_AT edges
  (`PERSON-STATIONED-AT.md`) — held until this exists, and the first
  mapping to build

This is the "living bundle": the mapping is not archived after it is
applied, it stays attached to its source until cutover.

---

## Cutover

1. Jan decides the application is mature enough.
2. Sanity is made read-only (or Jan simply stops editing).
3. A final sync runs; all review bundles are resolved.
4. The graph becomes the authority. `SyncState`, `Mapping` nodes and the
   baseline can be dropped or archived; `sanityId` stays on nodes as
   provenance.
5. The public site on `main` moves off Sanity (tracked separately).

Until then, the less Jan edits the same content in both places, the
fewer conflicts there are. Once an entity type's editor is complete,
it is worth agreeing that that type is edited only in the graph.

---

## Suggested order

1. ~~Commit the report script; keep the baseline safe.~~
2. ~~Field-level compare for `person`.~~
3. ~~Apply for clean changes + new documents, with `SyncState`~~ — person,
   local only. Left: 37 people for review, 7 deleted in Sanity.
4. **Curated mapping for STATIONED_AT**, then run that migration.
5. Remaining types; conflicts and deletions through review bundles.

---

## Open questions

1. **Per-type cutover?** Can Jan stop editing one type in Sanity (e.g.
   people) before the others, shrinking the bridge as editors mature?
2. **Portable Text fields** (`description`) — compare the whole field, or
   per block so an edit in one paragraph doesn't make the whole
   description a conflict?
3. **Baseline backup** — the baseline is only on this machine. Copy to
   R2 alongside the bundles?
4. **Who resolves deletions** of documents that have graph-only content
   attached?
