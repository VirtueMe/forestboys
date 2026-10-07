/**
 * Write a package (docs/BUNDLE-FORMAT.md, #159) for a list of entities in the graph.
 *
 *   npx tsx scripts/bundles/export-package.ts --site=https://archive.example \
 *       --refs=Transport:mtb-683,Unit:kompani-linge [--refs-file=refs.txt] [--filter="what was selected"] \
 *       [--out=data/packages/name.json] [--write]
 *
 * A dry run unless --write: it reads the entities, checks the package and says what it holds and what was
 * left out; --write writes the file. Reads the local graph, or --production's (scripts/lib/env.ts). Nothing
 * is written to the graph either way.
 *
 * `--site` is the address of this archive: it goes into every entity's source ref. A kind without a page of
 * its own (an Article, a Source) gets a placeholder path, and the script says so.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { entityPath, isBridgeProp, makeEntitySnapshot, makePackage, validatePackage, type EntitySnapshot } from '../../functions/_lib/bundle-package.ts'
import { siteSlug } from '../../functions/_lib/bundle-from-package.ts'
import { loadEnv, WRITE } from '../lib/env.ts'
import { neo4jDriver } from '../lib/person-sync.ts'
import { parseRef, readEntity } from '../lib/package-graph.ts'

loadEnv()

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const site = arg('site')
if (!site || !/^https?:\/\/\S+$/.test(site)) { console.error('--site=<the address of this archive, https://…> is required'); process.exit(2) }

const fromFile = arg('refs-file') ? readFileSync(resolve(arg('refs-file')!), 'utf8').split(/[\s,]+/) : []
const wanted = [...(arg('refs')?.split(',') ?? []), ...fromFile].map(r => r.trim()).filter(Boolean)
if (!wanted.length) { console.error('give the entities: --refs=Kind:key,Kind:key or --refs-file=<file>'); process.exit(2) }

const refs = [...new Set(wanted)].map(r => ({ text: r, ref: parseRef(r) }))
const bad = refs.filter(r => !r.ref)
if (bad.length) { console.error(`not an entity reference (Kind:key, of a kind a package may hold): ${bad.map(b => b.text).join(', ')}`); process.exit(2) }

const driver  = neo4jDriver()
const session = driver.session({ defaultAccessMode: neo4j.session.READ })
const snapshots: EntitySnapshot[] = []
const missing: string[] = []
const dropped = new Map<string, number>()
const placeholder: string[] = []
let skippedEdges = 0
let sanityKeyedEdges = 0

try {
  for (const { ref } of refs) {
    const { kind, key } = ref!
    const parts = await readEntity(session, kind, key)
    if (!parts) { missing.push(`${kind}:${key}`); continue }
    for (const name of Object.keys(parts.props)) if (isBridgeProp(name)) dropped.set(name, (dropped.get(name) ?? 0) + 1)
    skippedEdges += parts.skippedEdges
    sanityKeyedEdges += parts.edges.filter(e => /sanity/i.test(e.to)).length
    let path = entityPath(kind, key)
    if (!path) { path = `/${kind.toLowerCase()}/${key}`; placeholder.push(`${kind}:${key}`) }
    snapshots.push(makeEntitySnapshot({ kind, key, props: parts.props, descriptions: parts.descriptions, edges: parts.edges, source: { site, path } }))
  }
} finally {
  await session.close()
  await driver.close()
}

const pkg = makePackage({ site, madeAt: new Date().toISOString(), ...(arg('filter') ? { filter: arg('filter') } : {}) }, snapshots)
const problems = validatePackage(pkg)

const count = (f: (e: EntitySnapshot) => number) => snapshots.reduce((n, e) => n + f(e), 0)
console.log(`\nPackage from ${site}: ${snapshots.length} of ${refs.length} entities`)
console.log(`  descriptions ${count(e => e.descriptions.length)}, edges ${count(e => e.edges.length)}`)
if (dropped.size) console.log(`  left out as bookkeeping: ${[...dropped].map(([n, c]) => `${n} ×${c}`).join(', ')}`)
if (skippedEdges) console.log(`  ${skippedEdges} edge(s) left out: they point at nodes that are not entities`)
if (sanityKeyedEdges) console.log(`  note: ${sanityKeyedEdges} edge(s) point at an entity whose key contains «sanity» (an image Source); the key is kept as it is`)
if (placeholder.length) console.log(`  placeholder path (the kind has no page): ${placeholder.join(', ')}`)
if (missing.length) console.log(`  NOT FOUND: ${missing.join(', ')}`)
if (problems.length) console.log(`  PROBLEMS:\n    ${problems.join('\n    ')}`)

if (missing.length || problems.length) process.exit(1)

const out = resolve(arg('out') ?? `data/packages/${siteSlug(site)}-${pkg.origin.madeAt.replace(/[:.]/g, '-')}.json`)
if (!WRITE) {
  console.log(`\n(dry run — pass --write to write ${out})`)
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`\nwritten: ${out}`)
}
