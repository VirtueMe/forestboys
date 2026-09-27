# Person stationed at a place — requirements

Requirements for recording **where a person was, and when**: a Person
linked to a Location or Station for a period of time. Draft for review —
the open questions at the end need answers before building.

---

## Why

- The Person page has a "Vært stasjonert på" section that is **always
  hidden**: its data came from Sanity reverse-references that were never
  migrated to the graph.
- The Station page has a "Deltakere" section reading `STATIONED_AT` —
  also always empty, for the same reason.
- Neither Sanity nor the graph has ever recorded **when** someone was at a
  place, which is what makes the link historically useful.

---

## Current state

| Where | Person ↔ place links | Dates | Role |
|---|---|---|---|
| Sanity `location.people[]` | 67 links on 18 Locations | none | none |
| Sanity `station.people[]` | 783 links on 50 Stations | none | none |
| Neo4j | **0** (not migrated) | — | — |

The legacy links do not all mean "stationed". Examples from the 18
Locations: a base ("Planet VENUS – Storsäthern"), a prison camp
("FANGELEIR Fagernesmoen"), a German air-warning post ("Luftwaffe –
luftvarsling – FluWa OSO 14"). **The link needs a role**, not just a
place and a period.

---

## Requirements

### Data

**R1 — One edge type, two target kinds.**
`(:Person)-[:STATIONED_AT]->(:Location | :Station)`. Station is a
specialised Location in the schema, and the Station page already reads
`STATIONED_AT`, so the same edge serves both.

**R2 — Timeframe on the edge.** `startDate`, `endDate`, each optional, in
the same partial formats used elsewhere: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`.

**R3 — Open end.** An empty `endDate` means *still there / unknown end*,
never "ended the same day". Display as "1943 –" (see Open question 3 for
"to end of war").

**R4 — Role.** A controlled vocabulary on the edge, e.g.:

| `role` | Norwegian UI | Meaning |
|---|---|---|
| `stationed` | Stasjonert | Served / based there (default) |
| `hiding` | I skjul | Hid there (safe house, cabin) |
| `imprisoned` | Fange | Held there (prison, camp) |
| `training` | Opplæring | Trained there |
| `operating` | Operatør | Ran something there (radio station, depot) |

The list is a starting point for Jan to adjust.

**R5 — Sources.** Each link carries citations like other edges
(`sourceRefs`), so a period can be backed by a page in a book.

**R6 — Note per link.** Optional prose about the stay, as a Description
node — the same pattern as membership notes
(`(Person)-[:HAS_STATIONED_NOTE]->(Description)-[:ABOUT_PLACE]->(place)`),
never a text property on the edge.

**R7 — Several periods, same place.** A person can be at the same place
more than once (e.g. 1942 and again 1944). See Open question 1 — the
current relation editor keys entries by place.

### Editing

**R8 — Edit from the Person page.** A "Stasjonert på" relation list in
Rediger, built on the existing `RelationListEditor` (as Medlemskap is):
search place → role → from / to → optional note. Search covers both
Locations and Stations, marked which is which.

**R9 — Edit from the place page (should).** On Location and Station
Rediger, a "Personer" list editing the same edges from the other side.
Lets Jan enter a whole camp roster in one place.

**R10 — Validation.** `endDate` not before `startDate`; partial dates
compare by their known part.

### Display

**R11 — Person page.** "Vært stasjonert på" lists place, role and period,
sorted by start date (undated last). Place links follow the existing
rule: admin → `/location/<slug>`, visitor → `/map/<slug>`.

**R12 — Location / Station page.** "Personer" (Station: existing
"Deltakere") lists person, role and period, sorted by start date.

**R13 — Undated links stay visible.** Migrated links have no dates; they
must still show, without an empty "–".

### Migration

**R14 — Import the 850 legacy links** from `data/sanity-location.json`
and `data/sanity-station.json` as `STATIONED_AT` edges with no dates,
`role: 'stationed'`, and a `sanity-migration:…` sourceRef so they can be
filtered and reviewed.

**R15 — Mark them as unreviewed.** Migrated edges get `state:
'candidate'` (the schema's claim-state convention), so Jan can review
roles and add dates; edited edges become `verified`.

**R16 — Zero errors.** The import reports every unresolved person or
place reference and must run clean before commit (bulk-op rule).

---

## Out of scope (for now)

- Map layer showing a person's movements over time.
- Timeline view of who was at a place when.
- Inferring periods from events (a person in an Incident AT a place).

---

## Open questions

1. **Same place, several periods** — `RelationListEditor` and the note
   storage key entries by target place. Support multiple rows per place
   (needs an edge id), or one row per place with the widest period?
2. **Role list** — is the table in R4 right? Anything missing (born,
   lived, buried — or do those belong to separate `BORN_AT` / `HOME_AT`
   edges as the schema suggests)?
3. **Open end** — show plain "1943 –", or "til krigens slutt" (ties into
   the war-end-date question in `EQUIPMENT-LIFECYCLE.md`)?
4. **Migration roles** — import everything as `stationed` and let Jan
   correct, or pre-set `imprisoned` for places whose title says
   FANGELEIR / fengsel?
5. **Enemy posts** — should a link to a German post (the Luftwaffe
   example) be `STATIONED_AT` at all, or is it a different relation
   (e.g. surveillance, sabotage target)?
