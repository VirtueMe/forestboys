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
| `tools/` | Small helpers (`hash-password`). |
| `lib/` | Shared code. `person-rule`, `event-rule` and `import-missing-refs` are TypeScript ports of the Clojure import rules in `../migration/`; change a rule in both. `env.ts` decides which Neo4j a script talks to. |
| `bot/`, `prompts/` | The proposal bot: the local runner and the prompts it renders. |

## Local or production

A script talks to the local Neo4j (`.env`, which must be `localhost`) unless you pass
`--production`, which uses `.env.production` and prints the target first. Production
writes need your say-so each time.

Most scripts that write are a **dry run unless you pass `--write`**. Not all: a few
(`seed-roles`, `flatten-page-cards`, `promote-heading-text-cards`) write
unless you pass `--dry`, and the banner
printed for `--production` is wrong for those. Until the convention is unified
(#78), read the script's header before running it, and pass `--dry` first where it exists.
