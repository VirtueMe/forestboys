/**
 * Validates events piped from neo4j-fetch.ts and passes them through to stdout.
 * Errors and warnings go to stderr so they don't pollute the pipe.
 *
 * Usage:
 *   npx tsx scripts/neo4j-fetch.ts | npx tsx scripts/neo4j-validate.ts | npx tsx scripts/neo4j-import.ts
 */

async function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let raw = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    process.stdin.on('end', () => resolve(raw))
  })
}

const raw  = await readStdin()
const events = JSON.parse(raw) as Record<string, unknown>[]

let warnings = 0
let errors   = 0

for (const event of events) {
  const id = (event.slug ?? event._id ?? '?') as string

  if (!event.slug)         { process.stderr.write(`ERROR   [${id}] missing slug\n`);         errors++ }
  if (!event.title)        { process.stderr.write(`ERROR   [${id}] missing title\n`);        errors++ }
  if (!event.date)         { process.stderr.write(`WARN    [${id}] missing date\n`);          warnings++ }
  if (!event.organization) { process.stderr.write(`WARN    [${id}] missing organization\n`); warnings++ }
  if (!event.district)     { process.stderr.write(`WARN    [${id}] missing district\n`);     warnings++ }

  const people = (event.people ?? []) as Record<string, unknown>[]
  people.forEach((p, i) => {
    if (!p.slug) { process.stderr.write(`WARN    [${id}] person[${i}] missing slug — will be skipped\n`); warnings++ }
  })

  const transport = (event.transport ?? []) as Record<string, unknown>[]
  transport.forEach((t, i) => {
    if (!t.slug) { process.stderr.write(`WARN    [${id}] transport[${i}] missing slug — will be skipped\n`); warnings++ }
  })
}

process.stderr.write(`\nValidation: ${events.length} events — ${errors} errors, ${warnings} warnings\n\n`)

if (errors > 0) {
  process.stderr.write('Aborting due to errors.\n')
  process.exit(1)
}

// Pass through to next stage
process.stdout.write(raw + '\n')
