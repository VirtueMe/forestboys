---
name: Bot task — proposal generation
about: Request a proposal from Claude for one Portable Text block. Created by `functions/api/proposals/request.ts` when Jan attaches an outline to an entity. Not intended for humans to file manually.
title: "bot-task: <kind> <entityId> / outline <outlineId> §<sectionPath>"
labels: [bot-task]
assignees: []
---

<!--
  This issue is the contract between the Cloudflare Function that
  requests a proposal and the GitHub Action that runs Claude.

  - The Function creates the issue with the JSON block below populated.
  - The Action (.github/workflows/bot-task.yml) reads the JSON, fetches
    entity context from Cloudflare, renders scripts/prompts/proposal-block.txt
    with the variables, runs Claude, and POSTs the result to
    /api/proposals/ingest.
  - On success the Action comments with the R2 path + Jan's review URL,
    then closes the issue.
  - On failure the issue stays open with the failure log so it can be
    re-run.

  Do not edit the JSON block by hand unless you are debugging — the
  Function generates it, and the Action's parser is brittle on
  whitespace inside the fence.
-->

## Request

```json
{
  "entityId":    "<kind>:<slug>",
  "kind":        "Person | Unit | Station | Transport | Operation | Incident | Location | Outline",
  "slug":        "<entity slug>",
  "blockPath":   "section.<sectionSlug>.block.<blockKey>",
  "outlineId":   "<outline slug>",
  "outlineRev":  "<outline _rev at request time>",
  "sectionPath": "<section path inside the outline>",
  "promptHash":  "<sha256 first 12 chars of scripts/prompts/proposal-block.txt at request time>"
}
```

## Context fetch

The Action fetches additional context from Cloudflare before invoking
Claude:

- `GET /api/entity/<kind>/<slug>/context` — entity card scalars, edges,
  existing descriptions
- `GET /api/proposals/similar-accepts?kind=<kind>&outlineId=<outlineId>` —
  recent positive examples for few-shot
- `GET /api/proposals/similar-denials?kind=<kind>&outlineId=<outlineId>` —
  recent denials with Jan's reasoning, used as negative examples

Both are gated by an HMAC header — the Action provides
`X-Hub-Signature-256` over the request path with `BOT_INGEST_SECRET`.

## Result

The Action POSTs the proposal to `POST /api/proposals/ingest` with
HMAC auth. See `docs/PROPOSALS.md` § "Pipeline components" for the
ingest contract and the proposal-entry shape.

## Re-running

Edit-and-save the issue (or re-add the `bot-task` label) to re-trigger
the Action. The proposal file in R2 will be overwritten — newest wins.
