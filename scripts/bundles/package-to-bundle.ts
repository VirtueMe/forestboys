/**
 * Compare a package (docs/BUNDLE-FORMAT.md, #159) with the graph and make the review bundle of what differs.
 *
 *   npx tsx scripts/bundles/package-to-bundle.ts --package=data/packages/name.json \
 *       [--authoritative-edges=MEMBER_OF,PART_OF] [--out=data/bundles/name.json] [--write]
 *
 * A dry run unless --write: it reads the package, finds each entity in the graph (the node an earlier import
 * made from the same source ref, else the same kind and slug), and lists what would change. --write writes
 * the bundle to a file. It does not send it anywhere and does not touch the graph: a package never enters
 * the graph except through a bundle the admin accepts. Ingest learns the `package` origin and the
 * `set-description` op in #161.
 *
 * Reads the local graph, or --production's (scripts/lib/env.ts).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { refOf, sourceRefText, validatePackage, type BundlePackage } from '../../functions/_lib/bundle-package.ts'
import { buildBundleBody } from '../../functions/_lib/bundle-from-package.ts'
import { diffPackage, type DiffOp, type Match } from '../../functions/_lib/snapshot-diff.ts'
import { loadEnv, WRITE } from '../lib/env.ts'
import { neo4jDriver } from '../lib/person-sync.ts'
import { findNode } from '../lib/package-graph.ts'

loadEnv()

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const file = arg('package')
if (!file) { console.error('--package=<a package file> is required'); process.exit(2) }

const pkg = JSON.parse(readFileSync(resolve(file), 'utf8')) as BundlePackage
const problems = validatePackage(pkg)
if (problems.length) { console.error(`the package cannot be used:\n  ${problems.join('\n  ')}`); process.exit(1) }

const authoritativeEdgeTypes = arg('authoritative-edges')?.split(',').map(s => s.trim()).filter(Boolean)

const driver  = neo4jDriver()
const session = driver.session({ defaultAccessMode: neo4j.session.READ })
const renamed: string[] = []

let diff
try {
  // An entity an earlier import made here may have been renamed since: it is compared under the key it has now.
  const rekeyed: BundlePackage = { ...pkg, entities: [] }
  const matches = new Map<string, Match>()
  for (const snapshot of pkg.entities) {
    const found = await findNode(session, snapshot.kind, snapshot.key, sourceRefText(snapshot.source))
    const entity = found && found.key !== snapshot.key ? { ...snapshot, key: found.key } : snapshot
    if (entity !== snapshot) renamed.push(`${refOf(snapshot)} → ${refOf(entity)}`)
    rekeyed.entities.push(entity)
    matches.set(refOf(entity), found ? { live: found.live, linked: found.linked } : { live: null, linked: false })
  }
  diff = await diffPackage(rekeyed, s => matches.get(refOf(s))!, { authoritativeEdgeTypes })
} finally {
  await session.close()
  await driver.close()
}

const summary = (ops: DiffOp[]) => ops.map(o =>
  o.op === 'create-entity' ? `create (${Object.keys(o.props).length} props, ${o.descriptions.length} descriptions, ${o.edges.length} edges)`
  : o.op === 'set-props' ? `set ${Object.keys(o.props).join(', ')}`
  : o.op === 'set-description' ? `description ${o.order}`
  : `${o.op} ${o.type} ${o.to}`).join('; ')

console.log(`\nPackage from ${pkg.origin.site}: ${pkg.entities.length} entities`)
for (const e of diff.entities) console.log(`  ${e.entityId}: ${summary(e.ops)}${e.note ? `\n      ! ${e.note}` : ''}`)
if (diff.unchanged.length) console.log(`  already up to date: ${diff.unchanged.length}${diff.unchanged.length <= 8 ? ` (${diff.unchanged.join(', ')})` : ''}`)
if (renamed.length) console.log(`  matched under another key (renamed here): ${renamed.join(', ')}`)

const now  = new Date().toISOString()
const body = buildBundleBody(pkg, diff, now)
if (!body) { console.log('\nNothing to do: the graph holds what the package says.'); process.exit(0) }

const out = resolve(arg('out') ?? `data/bundles/${body.bundleId.replace(/[:]/g, '_')}.json`)
if (!WRITE) {
  console.log(`\n${body.summary}\n(dry run — pass --write to write ${out})`)
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`)
  console.log(`\n${body.summary}\nwritten: ${out}\nIt is not sent anywhere: ingest takes the package origin once #161 is in.`)
}
