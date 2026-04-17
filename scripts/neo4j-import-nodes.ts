/**
 * Phase 1: Import entity nodes into Neo4j.
 * Reads from data/cypher-clean/<type>.nodes.cypher
 *
 * Usage:
 *   npx tsx scripts/neo4j-import-nodes.ts
 *   npx tsx scripts/neo4j-import-nodes.ts -t organization,district
 *   npx tsx scripts/neo4j-import-nodes.ts -p          # production
 *   npx tsx scripts/neo4j-import-nodes.ts -d          # dry run
 */

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { runImport, resolveTypes } from './lib/neo4j-import.ts'

const argv = await yargs(hideBin(process.argv))
  .usage('$0 [options]')
  .option('type', { alias: 't', type: 'string', default: 'all', describe: 'Types to import' })
  .option('production', { alias: 'p', type: 'boolean', default: false, describe: 'Use .env.production' })
  .option('dry-run', { alias: 'd', type: 'boolean', default: false, describe: 'Parse only' })
  .strict().help().parse()

const ok = await runImport({
  types: resolveTypes(String(argv.type)),
  production: Boolean(argv.production),
  dryRun: Boolean(argv.dryRun),
  suffix: '.nodes',
})

process.exit(ok ? 0 : 1)
