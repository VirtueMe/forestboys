/**
 * Batch Results: Poll Anthropic batch and write Cypher output files
 *
 * Reads data/batch-id.txt, polls until the batch is done, then writes
 * Cypher statements grouped by document type to data/batch-runs/{batchId}/{type}.cypher.
 *
 * Run after batch-submit.ts:
 *   npx tsx scripts/batch-results.ts                   # reads data/batch-id.txt
 *   npx tsx scripts/batch-results.ts msgbatch_...      # explicit batch ID override
 *
 * Safe to re-run — overwrites existing output files.
 */

import Anthropic from '@anthropic-ai/sdk'
import * as dotenv from 'dotenv'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env') })

const DATA_DIR      = resolve(process.cwd(), 'data')
const BATCH_ID_FILE = resolve(DATA_DIR, 'batch-id.txt')

const POLL_INTERVAL_MS = 60_000       // 1 minute
const POLL_TIMEOUT_MS  = 6 * 60 * 60 * 1000  // 6 hours

async function main() {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set in .env')
    process.exit(1)
  }

  const idArg = process.argv[2]?.startsWith('msgbatch_') ? process.argv[2] : null

  if (!idArg && !existsSync(BATCH_ID_FILE)) {
    console.error('data/batch-id.txt not found — run batch-submit.ts first, or pass a batch ID directly:')
    console.error('  npx tsx scripts/batch-results.ts msgbatch_...')
    process.exit(1)
  }

  const batchId    = idArg ?? readFileSync(BATCH_ID_FILE, 'utf8').trim()
  const CYPHER_DIR = resolve(DATA_DIR, 'batch-runs', batchId)
  console.log(`Polling batch ${batchId}…\n`)

  // Load run metadata to know which model was used per type
  const runMetaFile = resolve(DATA_DIR, 'batch-runs', `${batchId}.json`)
  const runMeta = existsSync(runMetaFile)
    ? JSON.parse(readFileSync(runMetaFile, 'utf8')) as {
        types: { type: string; model: string }[]
        flags: { modelOverride: string | null }
      }
    : null
  const modelForType = (type: string): string => {
    if (runMeta?.flags.modelOverride) return runMeta.flags.modelOverride
    return runMeta?.types.find(t => t.type === type)?.model ?? 'claude-sonnet-4-6'
  }

  const client = new Anthropic({ apiKey })

  // Poll until ended (run inside tmux — survives SSH disconnects)
  //   tmux new-session -d -s milorg_batch 'npx tsx scripts/batch-results.ts'
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let batch = await client.messages.batches.retrieve(batchId)
  while (batch.processing_status !== 'ended') {
    if (Date.now() > deadline) {
      console.error('\nTimeout: batch still not ended after 6 hours. Re-run to resume polling.')
      process.exit(1)
    }
    const counts = batch.request_counts
    process.stdout.write(
      `\r[${new Date().toISOString().slice(11, 19)}] ${batch.processing_status}  ` +
      `processing:${counts.processing}  succeeded:${counts.succeeded}  errored:${counts.errored}    `
    )
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    batch = await client.messages.batches.retrieve(batchId)
  }

  const counts = batch.request_counts
  console.log(`\n\nBatch complete!`)
  console.log(`  Succeeded: ${counts.succeeded}`)
  console.log(`  Errored:   ${counts.errored}`)
  console.log(`  Expired:   ${counts.expired}`)
  console.log(`  Cancelled: ${counts.canceled}`)

  // Collect results grouped by type
  const cyphers: Record<string, string[]> = {}
  const errors:  { id: string; error: unknown }[] = []
  const expired: string[] = []

  type TokenTotals = {
    input: number; output: number; cacheRead: number; cacheWrite: number; docs: number
  }
  const tokens: Record<string, TokenTotals> = {}

  for await (const result of await client.messages.batches.results(batchId)) {
    // custom_id format: "{type}__{sanityId}"
    const sepIdx = result.custom_id.indexOf('__')
    const type     = sepIdx >= 0 ? result.custom_id.slice(0, sepIdx) : 'unknown'
    const sanityId = sepIdx >= 0 ? result.custom_id.slice(sepIdx + 2) : result.custom_id

    switch (result.result.type) {
      case 'succeeded': {
        const blocks = result.result.message.content
        const text = blocks
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim()

        if (text) {
          if (!cyphers[type]) cyphers[type] = []
          cyphers[type].push(`// ── ${sanityId} ──\n${text}`)
        }

        // Accumulate token usage
        const u = result.result.message.usage as {
          input_tokens: number; output_tokens: number
          cache_read_input_tokens?: number; cache_creation_input_tokens?: number
        }
        if (!tokens[type]) tokens[type] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, docs: 0 }
        tokens[type].input      += u.input_tokens
        tokens[type].output     += u.output_tokens
        tokens[type].cacheRead  += u.cache_read_input_tokens  ?? 0
        tokens[type].cacheWrite += u.cache_creation_input_tokens ?? 0
        tokens[type].docs       += 1
        break
      }
      case 'errored':
        errors.push({ id: result.custom_id, error: result.result.error })
        break
      case 'expired':
        expired.push(result.custom_id)
        break
    }
  }

  // Write Cypher files into the batch-run folder
  mkdirSync(CYPHER_DIR, { recursive: true })

  for (const [type, blocks] of Object.entries(cyphers)) {
    const file = resolve(CYPHER_DIR, `${type}.cypher`)
    writeFileSync(file, blocks.join('\n\n') + '\n')
    console.log(`  Wrote ${String(blocks.length).padStart(5)} blocks → data/batch-runs/${batchId}/${type}.cypher`)
  }

  // Write error log
  if (errors.length > 0) {
    const errFile = resolve(CYPHER_DIR, 'errors.json')
    writeFileSync(errFile, JSON.stringify(errors, null, 2) + '\n')
    console.log(`\n  ${errors.length} errors written to data/batch-runs/${batchId}/errors.json`)
  }

  if (expired.length > 0) {
    const expFile = resolve(CYPHER_DIR, 'expired.json')
    writeFileSync(expFile, JSON.stringify(expired, null, 2) + '\n')
    console.log(`\n  ${expired.length} expired → data/batch-runs/${batchId}/expired.json`)
    console.log('  Resubmit with: --type <type> --index <n> for each affected range')
  }

  // ── Cost summary ─────────────────────────────────────────────────────────
  // Batch API pricing (50% discount applied):
  //   Sonnet 4.6:  $1.50 / MTok input,  $7.50 / MTok output
  //   Haiku 4.5:   $0.50 / MTok input,  $2.50 / MTok output
  // Cache reads:   $0.15 / MTok (Sonnet) | $0.05 / MTok (Haiku)  — both models
  // Cache writes:  same as input price (one-time cost, amortised across batch)
  //
  // Model is not stored per-result, so we use a heuristic:
  //   event → Sonnet (always inference-heavy)
  //   person → Sonnet
  //   location / station / transport → check for Haiku pricing

  function estimateCost(type: string, t: TokenTotals): number {
    const model = modelForType(type)
    const isHaiku = model.includes('haiku')
    const inputRate      = isHaiku ? 0.50  : 1.50   // $ per MTok (batch rate, 50% discount)
    const outputRate     = isHaiku ? 2.50  : 7.50
    const cacheReadRate  = isHaiku ? 0.05  : 0.15
    const cacheWriteRate = inputRate                  // same as input
    const M = 1_000_000
    return (
      (t.input      / M) * inputRate +
      (t.output     / M) * outputRate +
      (t.cacheRead  / M) * cacheReadRate +
      (t.cacheWrite / M) * cacheWriteRate
    )
  }

  console.log('\nExtraction summary:')
  let totalCost = 0
  for (const [type, blocks] of Object.entries(cyphers)) {
    const t = tokens[type]
    if (!t) { console.log(`  ${type.padEnd(14)} ${String(blocks.length).padStart(5)} docs`); continue }
    const cost = estimateCost(type, t)
    totalCost += cost
    const cacheHitPct = t.input > 0 ? Math.round(t.cacheRead / (t.input + t.cacheRead) * 100) : 0
    console.log(
      `  ${type.padEnd(14)} ${String(blocks.length).padStart(5)} docs` +
      `  in:${Math.round(t.input/1000)}k  out:${Math.round(t.output/1000)}k` +
      `  cache:${cacheHitPct}%  est $${cost.toFixed(3)}`
    )
  }
  if (Object.keys(tokens).length > 1) console.log(`  ${'TOTAL'.padEnd(14)}        est $${totalCost.toFixed(3)}`)

  // Save token usage alongside Cypher files
  writeFileSync(resolve(CYPHER_DIR, 'usage.json'), JSON.stringify(tokens, null, 2) + '\n')

  // ── ntfy.sh notification ─────────────────────────────────────────────────
  // Set NTFY_TOPIC in .env (e.g. milorg-batch-benny), subscribe in ntfy app
  const ntfyTopic = process.env['NTFY_TOPIC']
  if (ntfyTopic) {
    const summary = `${counts.succeeded} ok / ${counts.errored} errors / ${counts.expired} expired`
    await fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      headers: {
        'Title':    'Milorg batch complete',
        'Priority': counts.errored > 0 ? 'high' : 'default',
        'Tags':     counts.errored > 0 ? 'warning' : 'white_check_mark',
      },
      body: `Batch ${batchId}\n${summary}`,
    }).catch(() => console.warn('ntfy notification failed — continuing'))
  }

  console.log(`\nDone. Output in data/batch-runs/${batchId}/`)
  console.log('Load Cypher into Neo4j with neo4j-import.ts or via cypher-shell.')
}

main().catch(err => { console.error(err); process.exit(1) })
