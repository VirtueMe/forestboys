/**
 * Convert what we built from outlines (the nodes with a `sanityOutlineId`) into bundles for Jan to accept (#158).
 *
 *   npx tsx scripts/migrations/outlines-to-bundles.ts --site=https://archive.example [--out=data/outlines-conversion] [--write]
 *   npx tsx scripts/migrations/outlines-to-bundles.ts --remove [--out=data/outlines-conversion] [--write]
 *
 * 1. Without --remove: reads the nodes and what touches them, makes the archive (a package of snapshots, the edges
 *    into them, and everything it takes to put the nodes back) and one bundle per outline, and checks the bundles
 *    against the archive. A dry run says what it holds; --write writes `archive.json` and `bundles/<outline>.json`
 *    under --out. Nothing is sent anywhere and nothing is removed.
 * 2. With --remove: checks the archive and the bundles are in --out and still hold what the graph holds, then removes
 *    the nodes and the edges that touch them in one transaction (rolled back unless the counts are exactly the
 *    archive's). A dry run unless --write. The write is the owner's, after a dump and after the bundles were seen to render.
 *
 * Local graph unless --production (scripts/lib/env.ts). Ingest of the bundles is a separate step.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv, WRITE } from '../lib/env.ts'
import { neo4jDriver } from '../lib/person-sync.ts'
import {
  buildArchive, buildOutlineBundle, checkAgainstArchive, countGraph, readConversion, removeConverted,
  type ConversionArchive, type OutlineBundleBody,
} from '../lib/outline-conversion.ts'

loadEnv()

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const REMOVE = process.argv.includes('--remove')
const out = resolve(arg('out') ?? 'data/outlines-conversion')
const archiveFile = join(out, 'archive.json')
const bundlesDir  = join(out, 'bundles')

const readBundles = (): OutlineBundleBody[] =>
  readdirSync(bundlesDir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(bundlesDir, f), 'utf8')) as OutlineBundleBody)

const driver  = neo4jDriver()
const session = driver.session({ defaultAccessMode: REMOVE && WRITE ? neo4j.session.WRITE : neo4j.session.READ })

try {
  if (!REMOVE) {
    const site = arg('site')
    if (!site || !/^https?:\/\/\S+$/.test(site)) { console.error('--site=<the address of this archive, https://…> is required'); process.exit(2) }

    const conversion = await readConversion(session, site)
    const now = new Date().toISOString()
    const archive = buildArchive(conversion, site, now)
    const bundles = conversion.groups.map(g => buildOutlineBundle(g, now))
    const problems = checkAgainstArchive(archive, bundles)

    const edges = archive.raw.edges.length
    console.log(`\n${conversion.raw.nodes.length} nodes in ${conversion.groups.length} outlines, ${edges} edges touch them`)
    for (const g of conversion.groups) {
      console.log(`  ${g.outlineSlug.padEnd(40)} ${g.entity.kind}:${g.entity.key} — ${g.entity.descriptions.length} description(s), ${g.entity.edges.length} edges out, ${g.inbound.length} in`)
    }
    const why = { 'not-entity': 'the other end is no entity', 'bad-slug': 'the slug is padded, re-add from the archive once fixed', 'not-ours': 'not made by the import or us: dropped' } as const
    for (const reason of ['bad-slug', 'not-entity', 'not-ours'] as const) {
      const list = conversion.unlinked.filter(u => u.reason === reason)
      if (!list.length) continue
      console.log(`\n${list.length} edge(s) not in a bundle (${why[reason]}); they go with the removal and stay in the archive:`)
      for (const u of list) console.log(`  ${JSON.stringify(u.from)} -${u.type}-> ${u.to}`)
    }
    if (problems.length) { console.log(`\nPROBLEMS:\n  ${problems.join('\n  ')}`); process.exit(1) }
    console.log('\nThe bundles hold what the archive holds, and ingest accepts each of them.')

    if (!WRITE) {
      console.log(`(dry run — pass --write to write ${archiveFile} and ${bundles.length} bundles in ${bundlesDir})`)
    } else {
      mkdirSync(bundlesDir, { recursive: true })
      writeFileSync(archiveFile, `${JSON.stringify(archive, null, 2)}\n`)
      for (const b of bundles) writeFileSync(join(bundlesDir, `${b.outlineId}.json`), `${JSON.stringify(b, null, 2)}\n`)
      console.log(`written: ${archiveFile} and ${bundles.length} bundles in ${bundlesDir}`)
    }
  } else {
    if (!existsSync(archiveFile) || !existsSync(bundlesDir)) { console.error(`no archive and bundles in ${out}: run without --remove --write first`); process.exit(2) }
    const archive = JSON.parse(readFileSync(archiveFile, 'utf8')) as ConversionArchive
    const bundles = readBundles()

    const problems = checkAgainstArchive(archive, bundles)
    if (problems.length) { console.error(`the bundles do not hold what the archive holds:\n  ${problems.join('\n  ')}`); process.exit(1) }

    // The graph must still be what the archive saw: the same nodes and edges, nothing newer.
    const now = await readConversion(session, archive.package.origin.site)
    const nodes = archive.raw.nodes.map(n => n.key).sort().join('\n')
    const edges = archive.raw.edges.map(e => `${e.from}|${e.type}|${e.to}`).sort().join('\n')
    if (now.raw.nodes.map(n => n.key).sort().join('\n') !== nodes || now.raw.edges.map(e => `${e.from}|${e.type}|${e.to}`).sort().join('\n') !== edges) {
      console.error('the graph has changed since the archive was made: make the archive and bundles again'); process.exit(1)
    }

    const expected = { nodes: archive.raw.nodes.length, edges: archive.raw.edges.length }
    const before = await countGraph(session)
    console.log(`\nThe archive and ${bundles.length} bundles are in ${out} and match the graph.`)
    console.log(`Would remove ${expected.nodes} nodes and ${expected.edges} edges; the graph has ${before.nodes} nodes and ${before.edges} edges.`)
    if (!WRITE) {
      console.log('(dry run — pass --write to remove them)')
    } else {
      const r = await removeConverted(session, expected)
      console.log(`removed. nodes ${r.before.nodes} → ${r.after.nodes}, edges ${r.before.edges} → ${r.after.edges}, with sanityOutlineId ${r.before.converted} → ${r.after.converted}`)
    }
  }
} finally {
  await session.close()
  await driver.close()
}
