# Sanity sync — the bridge to cutover

How the graph keeps up with Sanity until Jan stops editing there. Draft
for review — nothing here is built yet except the sync report
(`scripts/sanity-sync.ts`). Extends `PROPOSALS.md`, which covers the
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
  `scripts/import-person-descriptions.ts`: 3 462 people, one section each,
  `description_state: 'candidate'`. 163 people with descriptions are not
  in the graph yet; the new-person import must bring theirs along.

---

## Sync

Run per Sanity type. `(:SyncState {source: 'sanity', type, importedUpTo})`
holds Sanity's own `_updatedAt` of the newest change taken in; it only
narrows which documents to look at.

1. Fetch documents with `_updatedAt >= importedUpTo` from `api.sanity.io`
   (not the CDN, which can lag), plus the full `_id` list for deletions.
   `scripts/sanity-sync.ts` does this today and writes a report.
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
4. Deleted documents: a review bundle proposing removal, showing graph
   edges that would be left dangling (e.g. stays entered in the graph for
   a person deleted in Sanity).
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
`scripts/sync-person.ts` refuses to write when it doesn't.

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
- gallery edges with editor props;
- graph links Sanity doesn't have.

Accepted on 2026-09-29 (graph slugs before the run; all 37 were checked
side by side, and the graph values were older Sanity states, never edits):

```
aksel-edvin-larsen,bjarne-iversen,claus-urbye-helberg,erling-jensen,harald-svindseth,henning-kofoed,ivar-naess,kjell-engelsen,knut-aarsaether,konrad-anker-hennum,lars-dalland,nils-eliassen-fjeld,ole-baarnes,per-blindheim,ragnar-ulstein,arvid-fossum,knut-mostue,finn-scheldrup-johansen,harald-storvik,peter-graben,nils-kristoffer-o-torsvik,sissel,johan-p-bjelland-thu,johan-hagemann,bjorn-norderhaug,frick,tor-jorgen-falkevik,o-berentsen,hugo-munthe-kaas,golda-goldstein,torvald-olai-lien,per-andreas-larsen,paul-magnussen-strande,ole-berg-lt
```

Held for Jan: `kare-helland` (Sanity name "Kåre Hellan"),
`2lt-polansky-henry-l` (Sanity slug `s-lt-polansky-henry-l`), `na` (a
person named "N/A").

### Where it has run

The scripts use `.env`, which is the **local** Neo4j. Production Aura
(`.env.production`) has had none of this. Status on 2026-09-29, local only:

| Step | Script | Result |
|---|---|---|
| Stationed roles | `scripts/seed-roles.ts` | 5 roles |
| Person descriptions | `scripts/import-person-descriptions.ts --write` | 3 462 |
| Person sync | `scripts/sync-person.ts --write` | 259 changed (20 slug renames), 173 new; 37 left for review |
| Rank split | `scripts/migrate-rank-split.ts --write` | 3 964 `RANK` edges; 1 history entry (PERSON-RANKS.md) |
| Person sync | `scripts/sync-person.ts --write` | 3 changed |
| Person sync, review | `scripts/sync-person.ts --write --accept-review=…` (list above) | 34 changed (5 slug renames); 3 held |

Production gets the same steps in the same order, behind an explicit
opt-in that doesn't exist yet.

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
- Outlines absorbed into Operations / Persons (the bundle pipeline)
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
