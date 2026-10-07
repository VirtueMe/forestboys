# scripts/

Run from the repository root, with `npx tsx scripts/<folder>/<name>.ts`. They read
`data/` (local, gitignored: the Sanity exports) and `.env` relative to the working
directory.

| Folder | What it is |
|---|---|
| `sync/` | The live Sanity → graph bridge (`docs/SANITY-SYNC.md`). CI runs `sync-person`, `sync-event` and `heartbeat` daily (`.github/workflows/sanity-sync.yml`). Also `reimport-events`, `import-missing-refs`, `import-person-descriptions`, and `import-outlines` (the only importer of `:Outline` nodes). |
| `sanity/` | Read-only looks at Sanity and at how far the graph has drifted: `sanity-sync`, `sanity-person-fields`, `sanity-event-fields`, and `sanity-export` (writes the `data/sanity-*.json` the others read). |
| `migrations/` | One-shot graph migrations. One that has run in production leaves the tree — git is the archive — so what is here is either still waiting for production or recent. |
| `seed/` | Reference data the app needs (`seed-roles`). |
| `e2e/` | The browser design checks (#139): `record-fixtures` records the pages of `e2e/pages.ts` from the local graph (a dry run unless `--write`; each page as a visitor, and, where it has one, in the edit mode an admin sees, #140), `replay-key` is how a recorded request is found again, and `flaky-summary` (plain `node`, run by CI) lists the tests that passed only on the retry in the job's summary (#149). |
| `bundles/` | Packages of entity snapshots (`docs/BUNDLE-FORMAT.md`, #159): `export-package` writes one for a list of entities, `package-to-bundle` compares a package with the graph and makes the review bundle of the difference. Both are dry runs unless `--write`, and neither writes to the graph. |
| `tools/` | Small helpers (`hash-password`). |
| `lib/` | Shared code. `person-rule`, `event-rule` and `import-missing-refs` are TypeScript ports of the Clojure import rules in `../migration/`; change a rule in both. `env.ts` decides which Neo4j a script talks to. |
| `bot/`, `prompts/` | The proposal bot: the local runner and the prompts it renders. |

## Local or production

A script talks to the local Neo4j (`.env`, which must be `localhost`) unless you pass
`--production`, which uses `.env.production` and prints the target first. Production
writes need your say-so each time.

Every script that can write is a **dry run unless you pass `--write`**, and the
`--production` banner says `read only` or `WRITING` from that same flag. `--dry`,
`--dry-run` and `--apply` are refused (exit 2), not ignored. `lib/env.ts` enforces
this at start-up, and `scripts/convention.test.ts` fails if a script reads an old
switch or opens a graph connection without going through `loadEnv`.
