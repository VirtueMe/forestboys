/**
 * Rewrite the descriptions of a package so the ANCC minutes are blocks and headings, not a few giant blocks (#259).
 *
 *   npx tsx scripts/bundles/split-minutes-package.ts --package=data/packages/ancc.json \
 *       [--only=ancc-04,ancc-24] [--corrections=scripts/bundles/ancc-corrections.json] [--out=data/packages/ancc-split.json] [--write]
 *
 * Reads a package `export-package` wrote and gives one back that says how the descriptions should be (docs/BUNDLE-FORMAT.md);
 * `package-to-bundle` then makes the review bundle of the difference. A dry run unless --write. It does not read or write
 * the graph. A description whose words would change, or whose headings would not pass the save check, is left as it is
 * and reported: nothing here may lose or move a word.
 *
 * The one way a word changes is a correction (--corrections, a list of `{ key, from, to }`): a mistake in the
 * scan that someone has read and named. Each must match exactly once, or the entity is left as it is. The words
 * are then compared against the corrected text, and every correction is listed in the output.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { validatePackage, type BundlePackage } from '../../functions/_lib/bundle-package.ts'
import type { SanityBlock } from '../../src/utils/portableText.ts'
import { loadEnv, WRITE } from '../lib/env.ts'
import { applyCorrections, restructureMinutes, type Correction } from '../lib/split-minutes.ts'

loadEnv()

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const file = arg('package')
if (!file) { console.error('--package=<a package file> is required'); process.exit(2) }

const corrections = arg('corrections') ? JSON.parse(readFileSync(resolve(arg('corrections')!), 'utf8')) as Correction[] : []

const only = arg('only')?.split(',').map(s => s.trim()).filter(Boolean)
const pkg = JSON.parse(readFileSync(resolve(file), 'utf8')) as BundlePackage
const problems = validatePackage(pkg)
if (problems.length) { console.error(`the package cannot be used:\n  ${problems.join('\n  ')}`); process.exit(1) }

const changed: string[] = []
const same: string[] = []
const refused: string[] = []
const corrected: string[] = []

const entities = pkg.entities
  .filter(e => !only || only.includes(e.key))
  .map(entity => {
    // Sections are new descriptions with higher orders, so there must be exactly one to cut up.
    if (entity.descriptions.length !== 1) { refused.push(`${entity.key}: ${entity.descriptions.length} descriptions, not one`); return entity }
    const [d] = entity.descriptions
    const parsed = applyCorrections(entity.key, JSON.parse(d.content) as SanityBlock[], corrections)
    if ('error' in parsed) { refused.push(`${entity.key}: ${parsed.error}`); return entity }
    const before = parsed.blocks
    for (const a of parsed.applied) corrected.push(`${entity.key}: ${a}`)
    const result = restructureMinutes(before, entity.key)
    if ('refused' in result) { refused.push(`${entity.key}: ${result.refused}`); return entity }
    const descriptions = result.sections.map((blocks, i) => ({ ...d, order: d.order + i, content: JSON.stringify(blocks) }))
    if (descriptions.length === 1 && descriptions[0].content === d.content) { same.push(entity.key); return entity }
    const all = result.sections.flat()
    changed.push(`${entity.key}: ${before.length} blocks → ${all.length} blocks in ${descriptions.length} sections, ${all.filter(b => /^h\d$/.test(b.style ?? '')).length} headings`)
    return { ...entity, descriptions }
  })

const out: BundlePackage = { ...pkg, entities }
const outProblems = validatePackage(out)
if (outProblems.length) { console.error(`the result is not a package:\n  ${outProblems.join('\n  ')}`); process.exit(1) }

console.log(`${entities.length} entities: ${changed.length} restructured, ${same.length} already as they should be, ${refused.length} left as they were`)
for (const line of changed) console.log(`  ${line}`)
for (const line of corrected) console.log(`  CORRECTED: ${line}`)
for (const line of refused) console.log(`  LEFT: ${line}`)

if (!WRITE) { console.log('\n(dry run — pass --write to write the package)'); process.exit(0) }

const target = resolve(arg('out') ?? file.replace(/\.json$/, '-split.json'))
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(out, null, 2) + '\n')
console.log(`\nwrote ${target}`)
