---
name: Bot task — denial analysis
about: Analyze a denied proposal so future runs avoid the same mistake. Created by the deny endpoint when Jan provides substantive reasoning. Not intended for humans to file manually.
title: "bot-deny-analysis: <kind> <entityId> / <blockPath>"
labels: [bot-deny-analysis]
assignees: []
---

<!--
  This issue is the contract between the Cloudflare deny endpoint and
  the GitHub Action that runs Claude in analysis mode.

  - The deny endpoint creates the issue when reason.length >= 40 (see
    docs/PROPOSALS.md § "Analysis trigger gate").
  - The Action (.github/workflows/bot-deny-analysis.yml) reads the JSON,
    fetches recent similar denials + the source outline context,
    renders scripts/prompts/denial-analysis.txt, runs Claude, and POSTs
    the analysis to /api/proposals/denial-analysis/ingest.
  - On success the Action comments with the R2 path of the analysis,
    then closes the issue.
  - On failure the issue stays open; the deny itself is already
    durable, so analysis failure does not roll the deny back.

  Do not edit the JSON block by hand unless you are debugging.
-->

## Denial

```json
{
  "entityId":  "<kind>:<slug>",
  "kind":      "Person | Unit | Station | Transport | Operation | Incident | Location | Outline",
  "slug":      "<entity slug>",
  "blockPath": "section.<sectionSlug>.block.<blockKey>",
  "deniedAt":  "<ISO-8601 timestamp>",
  "deniedBy":  "<user identifier from admin session>",
  "proposalRef": "proposals/<entityId>/denied/<ts>-<blockPath>.json"
}
```

## Jan's reasoning (verbatim)

```
<Jan's free-form reason from the deny endpoint, multiline,
preserved in his original language. The Action passes this to Claude
unchanged via ${JANS_REASON} in the prompt template.>
```

## Context fetch

The Action fetches additional context from Cloudflare:

- `GET <proposalRef>` — the denied proposal payload (newValue, source,
  derivedFrom)
- `GET /api/proposals/similar-denials?kind=<kind>&limit=10` — prior
  denials in this kind, used to surface patterns
- The source outline (from `derivedFrom.outlineId`) — fact-check Jan's
  reasoning rather than taking either side at face value

All gated by HMAC.

## Result

The Action POSTs the structured analysis to
`POST /api/proposals/denial-analysis/ingest` with HMAC auth. See
`docs/PROPOSALS.md` § "Analysis output shape" for the contract and
the controlled-vocab `rootCause` values.

The ingest endpoint:

1. Verifies HMAC.
2. Writes `denial-analyses/<kind>/<entityId>/<ts>-<blockPath>.json`.
3. Patches the matching `denied-corpus/<kind>.json` entry to add
   `analysisRef` + summary fields.
4. Comments on this issue + closes it.

## Re-running

Edit-and-save (or re-add the `bot-deny-analysis` label) to re-trigger.
The analysis file in R2 will be overwritten — newest wins. The
patched `denied-corpus` entry updates accordingly.
