# migration/

Clojure pipeline that reads the Sanity JSON dumps in `../data/` and emits Cypher
for the Neo4j graph, one namespace per round. It built the graph (rounds 0–3 and
the source, gallery and index rounds below), and it is where the **import rules**
live: the TypeScript ports in `../scripts/lib/` (`person-rule.ts`, `event-rule.ts`)
and `../scripts/sync/import-missing-refs.ts` mirror them for the nightly sync
(`../docs/SANITY-SYNC.md`). A change to a rule is therefore made in both places,
and the port is re-calibrated against the graph with
`../scripts/sanity/sanity-person-fields.ts` / `sanity-event-fields.ts`.

Dies when Jan switches over — don't invest in long-term polish.

## One-time setup

You need the Clojure CLI:

```sh
# macOS
brew install clojure/tools/clojure

# Linux / other: see https://clojure.org/guides/install_clojure
```

Editor:
- **Cursor / VS Code** — install the **Calva** extension.
- Other editors: Cursive (IntelliJ), CIDER (Emacs) also work.

## REPL workflow (primary — this is the "polished experience")

1. Open `migration/` in Cursor.
2. `Cmd/Ctrl+Shift+P` → **Calva: Start a Project REPL and Connect (Jack-in)**.
3. Choose `deps.edn` and tick the `:dev` alias (adds Portal + Clerk).
4. Open any namespace file, e.g. `src/linge/sanity.clj`.
5. `Alt+Enter` evaluates the form under the cursor. The `(comment ...)` blocks
   at the bottom of each ns are the REPL warm-ups — start there.

### Portal — live data inspector

In the REPL:

```clojure
(require '[portal.api :as p])
(def portal (p/open))       ; opens a browser window
(add-tap #'p/submit)
(tap> (take 3 persons))     ; anything you tap> appears in Portal
```

Portal is where you'll spend most of your time. Hot-reloads, navigates deep
structures, beautiful for poking at 3791 persons.

### Clerk — documented notebooks (optional)

```clojure
(require '[nextjournal.clerk :as clerk])
(clerk/serve! {:watch-paths ["notebooks"]})
;; Edit notebooks/*.clj — rendered live at http://localhost:7777
```

### Neo4j connection

The rounds only emit Cypher files — no driver needed; load them with the Neo4j
browser or `cypher-shell`. `export-pages` queries Neo4j directly, over its HTTP
transactional API, so there is no driver dependency either. If a direct Bolt
connection is ever wanted, pick a driver and add it to `deps.edn` then
(coordinates change often — check Clojars).

## Layout

```
src/linge/
  sanity.clj           load and index the Sanity dumps from ../data/
  cypher.clj           Cypher-as-data emitter (composable, testable)
  parse.clj            rank / status / flags from raw person name strings
  round_zero.clj       round 0: the Kompani Linge seed (vertical prototype)
  round_one.clj        round 1: the skeleton across the full dataset (orgs, sources,
                       ranks, persons, transports, stations, locations, HELD_RANK)
  pages.clj            round 1.5: Sanity `home` + `aboutUs` → Page / Card / Description
  outlines.clj         round 2: the 29 outlines classified into Units, Operations,
                       EquipmentTypes, Sources and Articles
  courses.clj          round 2.1: Kompani Linge's 30 training courses
  events.clj           round 3: events → Incidents, districts → Units, descriptions
  external_sources.clj every entity's links[] → Source nodes + REFERENCED_IN edges
  galleries.clj        every entity's gallery[] → Source{photograph} + HAS_IMAGE edges
  indexes.clj          constraints and indexes (idempotent, safe to re-run)
  export_pages.clj     Page / Card / Description bundles as JSON, read from Neo4j
```

## Run a round

`clj -M:<alias>`; each writes Cypher under `../data/` (gitignored, local):

| Round | Alias | Output |
|---|---|---|
| 0 | `:run` | `round-0/` — organizations, sources, ranks, persons, relationships |
| 1 | `:run-1` | `round-1/` |
| 1.5 | `:run-1-5` | `round-1.5/` |
| 2 | `:run-2` | `round-2/` |
| 2.1 | `:run-2-1` | `round-2.1/` |
| 3 | `:run-3` | `round-3/` |
| sources | `:run-sources` | `round-sources/` |
| galleries | `:run-galleries` | `round-galleries/` |
| indexes | `:indexes` | `round-indexes/` |
| — | `:export-pages` | page bundles as JSON (queries Neo4j) |

Three more folders in `../data/` are not produced by a namespace here:
`round-outlines/` is written by `../scripts/sync/import-outlines.ts`,
`round-kp-f-fix/` holds one hand-written patch (`patch.cypher`), and
`round-outline-link-refs/` is empty.
