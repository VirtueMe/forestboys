# Prompt test harness

**Local-only** harness for iterating on the prompts that drive the
production proposal pipeline (see `docs/PROPOSALS.md`):

| Prompt              | Used by (in production)                        | Trigger                       |
|---------------------|------------------------------------------------|-------------------------------|
| `proposal-bundle`   | `bot-task` GitHub Action (Generation pipeline) | Outline absorption requested  |
| `denial-analysis`   | `bot-deny-analysis` GitHub Action              | Substantive proposal denial   |

The harness runs the same `claude` CLI in headless mode that the
`anthropics/claude-code-action` invokes in CI, so a green local run is a
strong signal the production action will produce the same shape on real
inputs. There is no CI workflow for these tests — CI runs the real
pipelines on real issues; the fixtures here are for fast local iteration
before you push prompt changes.

## Layout

```
scripts/prompts/
  <prompt>.txt                                  ← template with ${VAR} placeholders
  fixtures/<prompt>/
    input-<case>.json                           ← {vars, outputFile}
    expected-shape.json                         ← JSON Schema for the output
  test.ts                                       ← local + CI runner
```

## Run locally

```bash
# All prompts, all fixtures
npm run prompts:test

# One prompt
npm run prompts:test proposal-bundle

# Filter fixtures by substring
npm run prompts:test proposal-bundle linge
```

Auth: uses your local `claude` CLI's session (run `claude` once to log
in). Or set `CLAUDE_CODE_OAUTH_TOKEN` in env — same secret used in CI.

## Adding a fixture

1. Drop a new file `fixtures/<prompt>/input-<short-name>.json` with the
   shape:
   ```json
   {
     "vars": { "ENTITY_ID": "...", "ENTITY_CONTEXT_JSON": { ... }, ... },
     "outputFile": "<short-name>.json"
   }
   ```
   Variables that are objects/arrays get JSON-stringified into the
   prompt automatically. `OUTPUT_PATH` and `PROMPT_HASH` are injected by
   the runner — don't set them in the fixture.

2. The `expected-shape.json` in the same dir is a JSON Schema (draft-07)
   the output is validated against. Edit if you intentionally change
   the prompt's output contract.

3. Run `npm run prompts:test <prompt> <short-name>` to verify.

## When to update the schema

The schema is the contract Cloudflare Functions on the receiving end of
the bot pipeline assume. Changing it without updating the corresponding
`functions/api/proposals/ingest.ts` (or `.../denial-analysis/ingest.ts`)
handler is a bug — they read these fields.

## Failure debugging

A failed run prints the path to the rendered prompt and the raw output:

```
▶ proposal-bundle/linge-pulje-4 ... ✗ FAIL
output failed schema validation:
[ { "instancePath": "/entities/0/ops/0/op", "message": "must be equal to one of the allowed values" } ]
raw output: /tmp/prompt-test-XXX/bundle-linge-pulje-4-2026-04-29T14-00-00Z.json
rendered prompt: /tmp/prompt-test-XXX/rendered-prompt.txt
```

Inspect the rendered prompt to see exactly what the model received.
