---
status: vision
audience: developer (Benny), editors (Jan, Rolf), future steward
---

# A self-evolving archive

## Purpose

The archive should not be a finished product that slowly goes stale. It should keep growing as new material arrives,
and it should be able to change its own structure when the material demands it. People stay in control throughout: AI
proposes, editors decide, and every decision is kept with its full history.

## The loop

```
New or changed document
        │
        ▼
  AI analysis (per document)
        │
        ├──► Knowledge proposals ──► Editor approves / rejects ──► Graph updated
        │    (new nodes, new connections)        │
        │                                        └─► Decision + discussion archived
        │
        └──► System proposals ──► Development issue ──► Developer builds ──► Model can represent more
             (new graph types, new relationship kinds,
              anything the current model cannot express)
```

Two kinds of output come from the same analysis:

1. **Knowledge proposals**: what the document says about people, places, organisations, events and how they connect.
   These go to the editors.
2. **System proposals**: what the document says that the current model *cannot* represent. These become development
   issues, so the system evolves in step with the material.

## What is in place (checked against the repository, 2026-10-21)

- **The knowledge graph** (Neo4j). It was not built from one batch extraction of documents. It comes from the Sanity
  import and the daily Sanity sync (`docs/SANITY-SYNC.md`), from package imports (`docs/BUNDLE-FORMAT.md`), from editors
  writing on the entity pages, and from outline absorption: the bot turns an *outline* (a long Sanity text) into a
  bundle of entities. Today the only "document" the analysis understands is an **Outline**.
- **The proposal system is live.** Bundles with one record per entity, accept / deny per entity with a mandatory deny
  reason, comments, an event log, an archive with restore, live updates through the `bundle-events` Durable Object, and
  origin stamps (`originOutline`, `originSha`, `originBundle`) on what a bundle creates (`docs/PROPOSALS.md`).
- **A first analysis path already exists, for outlines only, started by an editor.** `POST /api/proposals/request`
  (Pages Function) creates a `bot-task` GitHub issue; `.github/workflows/bot-task.yml` fetches the outline and its
  referenced entities, renders `scripts/prompts/proposal-bundle.txt`, runs Claude, and posts the bundle to
  `/api/proposals/ingest`. An outline has a derived state (`new`, `bundled`, `absorbed`, `stale`) from a content hash.
- **Not in place, though the docs describe it:** the denied-corpus is written on deny but never read by the bot
  (`SIMILAR_DENIALS_JSON` is an empty placeholder); the `bot-deny-analysis` workflow does not exist; the model id is
  hard-coded in the workflow; a run is not recorded as a record of its own; there is no schedule, no cost limit, and no
  system proposals.
- **The site runs on Cloudflare** (Pages, D1, R2, KV, Durable Object; `docs/CLOUDFLARE.md`).

## What is to be built

### 1. Triggering analysis
- An analysis runs when a document is added or changed.
- Analyses also run on a schedule, to revisit existing material as the model grows.
- Editors can trigger an analysis themselves, for one document or a selection.
- Cloudflare Workers receive the trigger and create a GitHub issue that represents the analysis job.

### 2. Running the analysis
- GitHub Actions pick up the analysis issue and run the AI analysis of the document.
- The analysis has access to the current graph model, so it can tell the difference between "new knowledge that fits"
  and "something the model cannot express".
- Every run records what it was given and what it produced (document reference, model, prompt version, output), so any
  result can be reproduced and audited later.

### 3. Feeding knowledge proposals into the existing proposal system
- Proposals for new nodes and connections from the automated analysis enter the same proposal flow editors already use.
- Each proposal links back to the source document and the analysis run that produced it.
- Rejected proposals are kept, so the same suggestion is not raised again without new evidence.

### 4. Turning system proposals into development work
- When the analysis finds something the model cannot represent, it creates a development issue describing the need,
  with examples from the source documents.
- Similar system proposals across documents are grouped instead of creating duplicates.
- Development issues are reviewed by a person before any work starts. The AI never changes the model on its own.

### 5. Closing the loop
- When the model is extended, affected documents can be re-analysed to pick up knowledge the old model could not hold.

## Principles

- **People decide.** AI proposes knowledge and system changes; editors and developers decide what is accepted.
- **Everything is traceable.** Every proposal links to its source, the run that produced it, and the decision made on it.
- **Reproducible runs.** An analysis can be replayed from what was recorded.
- **Small, removable parts.** Workers, issues and Actions are standard building blocks; any of them can be replaced
  without redesigning the loop.

## Open questions

- Which events count as "a document changed", and how are they detected?
- How often should scheduled analyses run, and over what selection of documents?
- How should editors trigger analyses in the interface?
- What is the cost ceiling per analysis and per month, and how is it enforced?
- Who reviews system proposals before they become development work?
- What is a "document"? Today it is an Outline. Source scans and archive pages are not analysable yet.
