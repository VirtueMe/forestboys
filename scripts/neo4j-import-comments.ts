/**
 * Phase 3: Import comment nodes into Neo4j.
 * Reads from data/cypher-clean/<type>.comments.cypher
 *
 * Usage:
 *   npx tsx scripts/neo4j-import-comments.ts
 *   npx tsx scripts/neo4j-import-comments.ts -t person,event
 *   npx tsx scripts/neo4j-import-comments.ts -p       # production
 *   npx tsx scripts/neo4j-import-comments.ts -d       # dry run
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
  suffix: '.comments',
})

process.exit(ok ? 0 : 1)
