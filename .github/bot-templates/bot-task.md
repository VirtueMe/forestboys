---
name: Bot task — bundle generation
about: Request a Claude-generated bundle absorbing one outline. Created by `functions/api/proposals/request.ts` when Jan triggers absorption. Not intended for humans to file manually.
title: "bot-task: absorb outline <outlineId> (rev <shortRev>)"
labels: [bot-task]
assignees: []
---

<!--
  This issue is the contract between the Cloudflare Function that
  requests a bundle and the GitHub Action that runs Claude.

  - The Function creates the issue with the JSON block below populated.
  - The Action (.github/workflows/bot-task.yml) reads the JSON, fetches
    the outline body + similar accepts/denials from R2, renders
    scripts/prompts/proposal-bundle.txt, runs Claude, and POSTs the
    resulting bundle to /api/proposals/ingest.
  - On success the Action comments with the bundle URL + Jan's review
    URL, then closes the issue.
  - On failure the issue stays open with the failure log so it can be
    re-run.

  Do not edit the JSON block by hand unless you are debugging — the
  Function generates it, and the Action's parser is brittle on
  whitespace inside the fence.
-->

## Request

```json
{
  "outlineId":  "<outline slug>",
  "outlineRev": "<outline _rev at request time>",
  "promptHash": "<sha256 first 12 chars of scripts/prompts/proposal-bundle.txt at request time>"
}
```

## What the bot produces

A bundle JSON object with this shape (see `docs/PROPOSALS.md` § "Bundle
shape" for the full spec):

```jsonc
{
  "bundleId":   "bundle:<outlineId>:<isoTimestamp>",
  "outlineId":  "<from request>",
  "outlineRev": "<from request>",
  "summary":    "<one-paragraph human-readable description of what this absorbs>",
  "promptHash": "<from request>",
  "model":      "<model id>",
  "createdAt":  "<ISO-8601>",
  "entities": [
    { "entityId": "<Kind>:<slug>", "ops": [ /* discriminated-union ops */ ] },
    ...
  ]
}
```

Each `ops` array can mix:
- `create-entity` (kind, slug, props, edges)
- `modify-block` (blockPath, expectedSha, newValue)
- `add-edge` / `remove-edge`
- `delete-entity`
- `obsolete-outline` (on the outline entity itself)

Edge targets must resolve to either live entities or other entities
being created in the same bundle.

## Result

The Action POSTs the bundle to `POST /api/proposals/ingest` with HMAC
auth. See `docs/PROPOSALS.md` § "Bot ingest" for the contract.

## Re-running

Edit-and-save (or re-add the `bot-task` label) to re-trigger. A fresh
run produces a new bundle with a different `bundleId` (timestamp-keyed)
so it doesn't collide with prior bundles for the same outline.
