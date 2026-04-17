# migration/

Clojure pipeline that reads Sanity JSON dumps and emits Cypher for the Neo4j
replacement tool. Dies when Jan switches over — don't invest in long-term polish.

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

### Neo4j direct connection (later)

Round-0 emits Cypher files — no driver needed yet. When you want a direct
Bolt connection, pick a driver and add it to `deps.edn` at that point.
Options: Neo4j's official Java driver (`org.neo4j.driver/neo4j-java-driver`,
use via Java interop), or one of the Clojure wrappers (coordinates change
often — check Clojars before adding).

## Layout

```
src/linge/
  sanity.clj      load and index Sanity dumps from ../data/
  parse.clj       extract rank / status / flags from raw person name strings
  cypher.clj      Cypher-as-data emitter (composable, testable)
  round_zero.clj  orchestrate round-0 seed for the Kompani Linge slice
```

## Run round-0 as a script

```sh
clj -M:run
```

Output goes to `../data/round-0/` :
- `00-organizations.cypher`
- `01-sources.cypher`
- `02-ranks.cypher`
- `03-persons.cypher`
- `04-relationships.cypher`

Does not touch `../data/cypher/` or `../data/cypher-clean/` (parallel clone's
isolated-extraction import lives there).

## Reference

`../scripts/round-0-importer.ts` — TypeScript version of the same logic.
Delete once the Clojure pipeline produces equivalent output.
