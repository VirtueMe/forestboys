# Person ranks — requirements

Requirements for recording a person's **rank**, and optionally the
**history** of ranks they held: when, whether acting, and why. Implemented
2026-09-29 on the local graph (production has none of this yet — see
`SANITY-SYNC.md`, *Where it has run*); decisions under *Decided*.

---

## Why

Today a rank is a list of `HELD_RANK` edges, edited in Grader
(`PersonRanksEditor.vue`, `PATCH /api/admin/person/:slug/ranks`), each with
optional `from` / `to` years. In practice (local graph, 2026-09-28):

| | People |
|---|---:|
| One `HELD_RANK` edge, from the migration (parsed from the Sanity name, or the Menig default), no dates | 3 963 |
| Edited in Grader (Martin Linge — Kaptein, `verified`, no dates) | 1 |
| Two or more ranks | 0 |

Two different things share that one list:

- **The rank a person is known by** — what Sanity's name carries
  ("Leif Tronstad Major"): one rank, no dates. Sanity is the authority for
  it until cutover, and the sync keeps it up to date.
- **The rank history** — promotions over time, researched by Jan from
  sources like the personnel records quoted in descriptions ("10/9-43
  Promoted act. 2/Lt."). Sanity has no such data.

Mixed in one list, the sync has to guess whether an edge is still the
migration's before it may touch it, and a Grader edit replaces the whole
list — including the Sanity-fed rank.

---

## Requirements

### Data

**R1 — The known rank: one edge.**
`(Person)-[:RANK {state, sourceRef}]->(Rank)`, exactly one per person.
It means *the rank the person is known by* — usually the final or highest
— not "current", which doesn't fit people in 1940–45. It is always the
**real (substantive) rank**; an acting rank is shown next to it (R9), never
stored here. It is a claim like
`home` or `birthYear`: `state` `candidate` / `verified`, `sourceRef` saying
where it came from (`sanity-migration:person:<id>:name:rank-token`, the
Menig default, or an editor save).

**R2 — History: zero or more entries.**
`(Person)-[:HELD_RANK {id, from, to, acting, state}]->(Rank)`.

- `id` — stable, so notes attach to an entry and a person can hold the
  same rank twice (acting, then substantive; or after a demotion).
  Same pattern as stays (`PERSON-STATIONED-AT.md`).
- `from` / `to` — partial dates, `YYYY`, `YYYY-MM` or `YYYY-MM-DD`,
  replacing today's years; the sources have day precision.
- `acting` — true when the person held the rank in an acting or temporary
  capacity (`act.` in the sources). The note says why. An acting entry
  runs **alongside** the real rank, not instead of it: a Løytnant acting
  as Kaptein is still a Løytnant.
- An empty `to` means *open* — still held, or the end is unknown.

**R3 — Why: a note per entry.**
`(Person)-[:HAS_RANK_NOTE]->(Description {rankEntryId})-[:ABOUT_RANK]->(Rank)`,
with citations — the usual relation-note shape; prose never lives on the
edge. It explains why the rank was awarded, or the acting circumstances,
backed by a source.

**R4 — Rank nodes unchanged.** Entries point at the existing Rank nodes,
so tier, branch and countries (Grader) keep working for sorting and
filtering.

### Sync

**R5 — Sanity feeds only the known rank.** The sync maps the name's rank
token (or the Menig default) to `RANK`, and never touches the history.
The guard it needs today ("only while the edge is still the
migration's") becomes the ordinary stamp compare for a field
(`SANITY-SYNC.md`): if `RANK` was set by an editor since, a changed name
goes to review.

### Editing

**R6 — Grad on the Person page.** Rediger shows:

- the known rank, as a picker;
- a "Historikk" relation list on `RelationListEditor` — rank, from / to,
  acting, note — keyed by entry id, like stays.

**R7 — A new rank closes the open one.** When an entry with a `from` date
is added, the open entry of the **same kind** — real or acting — whose
`from` is earlier gets `to` = the new entry's `from`. A new real rank
closes the open real rank; a new acting rank closes the open acting rank,
and leaves the real one alone. The editor does this when the entry is
added, visibly, before saving, so Jan can adjust it. An entry added
*between* existing ones (filling in history) closes nothing.

**R8 — Mismatch is a hint, not a block.** When the latest real history
entry (open, latest `from`) differs from the known rank, the editor says so
("Historikken slutter på Fenrik, grad er Løytnant") and offers to set the
rank from the history. It is never derived automatically — a history can
be incomplete.

### Display

**R9 — Person page.** The rank pill shows the known rank. When the latest
history entry is an open acting rank, the pill shows it first with the
real rank in brackets — *fungerende Kaptein (Løytnant)*.

When the person has history, the pill is **clickable** and opens the
history: entries sorted by `from` (undated last), each with period,
"fungerende" for acting, and its note (why it was awarded, with sources).
Without history, the pill is plain text.

**R10 — Other readers use the known rank.** Everything that shows "a
person's rank" today reads `HELD_RANK` and must switch to `RANK`:
`usePersonData.ts`, `useUnitData.ts` (members' ranks), `AdminRanksView.vue`
(usage count — count both), `EntityPreviewPanel.vue`.

### Migration (local first, production later with the rest)

**R11 — Move, don't change.** The 3 963 migration `HELD_RANK` edges become
`RANK` edges with the same `state` and `sourceRef`. The one Grader-edited
person (Martin Linge) gets `RANK` = Kaptein (`verified`) and keeps his
entry as history. Zero errors, and every person ends with exactly one
`RANK`.

---

## Implementation

| Piece | Where |
|---|---|
| Known rank | `PATCH /api/admin/person/:slug/rank` — `verified`, sourceRef `admin-edit` |
| History | `PATCH /api/admin/person/:slug/ranks` — ids, partial dates, acting |
| Entry note | `PATCH /api/admin/rank-note/:entryId` (`functions/_lib/edge-note.ts`, shared with stay notes) |
| Editor | `PersonRanksEditor.vue` (known rank + hint), `PersonRankHistoryEditor.vue` (R7 closing) |
| Pill + history popup | `PersonRanksPreview.vue` |
| Sync | `scripts/sync-person.ts` feeds `RANK` only; updates it only while its sourceRef is the migration's |
| Migration | `scripts/migrate-rank-split.ts` — local run: 3 963 migration ranks → `RANK`; Martin Linge → `RANK` Kaptein + 1 history entry |

## Decided (2026-09-28)

- **Acting** is a flag on the history entry; the note explains it.
- **Open end** — adding a rank with a `from` date closes the open entry
  with that date (R7). Closing works per kind, since an acting rank runs
  alongside the real one (the implication of the next point — check).
- **Acting shown with the real rank** — the known rank stays the real
  rank; an open acting rank displays as *fungerende Kaptein (Løytnant)*
  (R1, R9).
- **Visitors** — the rank pill opens the history, with notes, when there
  is one (R9).
