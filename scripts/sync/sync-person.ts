/**
 * Apply the Sanity → graph sync for people (docs/SANITY-SYNC.md).
 *
 * Changed people — per field, only verdicts that are safe
 * (scripts/lib/person-sync.ts):
 *   clean    → apply the Sanity value with the original rule
 *   already  → nothing to write but the stamp
 *   not-imported (description) → import it
 *   conflict / review → left alone, listed
 *
 * Slug changes follow Sanity: the graph app isn't live, while the live site
 * already uses Sanity's slugs (and Jan reuses freed slugs — the Reidulf
 * Larsen split). All renames run first, in one transaction, via temporary
 * slugs so chains can't trip the unique constraint; description ids follow.
 *
 * New people — created with the original rule (scripts/lib/person-rule.ts):
 * node + claims, RANK (the known rank), type, links, gallery, description.
 * The rank history (HELD_RANK) is Jan's and never synced (docs/PERSON-RANKS.md).
 *
 * Every applied field is stamped (`<field>_sha`, `<field>_graphSha`) so it
 * is compared against what was applied from now on, not the April export.
 * On a clean run, `(:SyncState {source: 'sanity', type: 'person'})` is set
 * to the newest `_updatedAt` seen.
 *
 * Refuses to write unless calibration is 100% (the rule still reproduces
 * the graph) and every new person resolves (slug free, rank exists).
 * One transaction per person. Before writing, the affected people's
 * properties and RANK / HELD_RANK / REFERENCED_IN / HAS_IMAGE / HAS_CONTENT edges
 * are saved to data/sanity-delta/person-before-<time>.json, so the run can
 * be undone.
 *
 * Review fields (no baseline — the graph was imported from a Sanity state
 * older than the April export) are left alone unless the person is named in
 * --accept-review: then Sanity's value applies as if clean. Naming a person
 * is the judgement that the graph holds no edits of its own beyond what can
 * be detected, and what can be detected still blocks the field: scalar
 * fields saved in the editor (`<field>_sourceRef: 'admin-edit'` — a conflict,
 * not review), gallery edges with editor props (hero, scope…), graph links
 * Sanity doesn't have. Editor saves before 2026-10-02 carry no marker.
 *
 * People deleted in Sanity are listed with what deleting them would do
 * (scripts/lib/person-deletions.ts): their event edges move to the person
 * Jan merged them into, where the Sanity event shows one; the rest goes.
 * Only the people named in --accept-delete are deleted.
 *
 * Usage: npx tsx scripts/sync/sync-person.ts [--write] [--accept-review=<slug>,…] [--accept-delete=<slug>,…]
 *        npx tsx scripts/sync/sync-person.ts --stamp [--write]   stamp the baseline into the graph, nothing else (#80)
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j, { type ManagedTransaction } from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import {
  FIELDS, calibrate, classify, fetchGraphPeople, fetchSanityPeople, loadApril, neo4jDriver, stampsFromBaseline, verifyStamps,
  sanityLinks, stampFor, str, type Doc, type GraphPerson,
} from '../lib/person-sync.ts'
import { imageSources, linkSource, parsePerson, personClaims, rankEdge, sanMigRef } from '../lib/person-rule.ts'
import { deletionStmts, deletionSummary, planDeletions } from '../lib/person-deletions.ts'
loadEnv()

const write = process.argv.includes('--write')
const stampOnly = process.argv.includes('--stamp')
const acceptReview = new Set(
  (process.argv.find(a => a.startsWith('--accept-review='))?.slice('--accept-review='.length) ?? '')
    .split(',').map(x => x.trim()).filter(Boolean))
const acceptDelete = new Set(
  (process.argv.find(a => a.startsWith('--accept-delete='))?.slice('--accept-delete='.length) ?? '')
    .split(',').map(x => x.trim()).filter(Boolean))
const OUT   = resolve(process.cwd(), 'data', 'sanity-delta', 'person-apply-plan.json')

type Stmt = { text: string; params: Record<string, unknown> }
interface Plan { sanityId: string; slug: string; summary: string[]; stmts: Stmt[] }
interface Rename { id: string; from: string; to: string }

const fieldByName = new Map(FIELDS.map(f => [f.name, f]))

function hasText(blocks: unknown): boolean {
  return Array.isArray(blocks) && blocks.some(b =>
    ((b as { children?: { text?: string }[] }).children ?? []).some(c => (c.text ?? '').trim()))
}

// ── Statement builders (all MATCH the person by sanityId) ──

const P = 'MATCH (p:Person {sanityId: $id})'

function scalarStmt(id: string, field: 'home' | 'secretName' | 'birthYear', value: unknown): Stmt {
  if (value === undefined || value === null || value === '') {
    return { text: `${P} REMOVE p.${field}, p.${field}_state, p.${field}_sourceRef`, params: { id } }
  }
  return {
    text: `${P} SET p.${field} = $value, p.${field}_state = 'candidate', p.${field}_sourceRef = $ref`,
    params: { id, value, ref: sanMigRef('person', id, field) },
  }
}

/** Name: canonicalName (when clean), and the parts the rule derives from it — each only
 *  while it is still the migration's own claim, so graph edits (known rank, status) survive. */
function nameStmts(id: string, name: string, setCanonical: boolean, g: GraphPerson, summary: string[]): Stmt[] {
  const parsed = parsePerson(name)
  const out: Stmt[] = []
  if (setCanonical) out.push({ text: `${P} SET p.canonicalName = $v REMOVE p.canonicalName_sourceRef, p.canonicalName_state`, params: { id, v: parsed.canonicalName } })

  const migrationRank = !!g.knownRank?.sourceRef?.startsWith('sanity-migration:')
  const want = rankEdge(id, parsed)
  if (migrationRank && g.knownRank?.rankSlug !== want.rankSlug) {
    out.push({
      text: `${P}
             MATCH (p)-[k:RANK]->() DELETE k
             WITH p MATCH (rk:Rank {slug: $rank})
             CREATE (p)-[:RANK {state: 'candidate', sourceRef: $ref}]->(rk)`,
      params: { id, rank: want.rankSlug, ref: want.sourceRef },
    })
    summary.push(`rank ${g.knownRank?.rankSlug} → ${want.rankSlug}`)
  } else if (!migrationRank && g.knownRank?.rankSlug !== want.rankSlug) {
    summary.push(`rank kept (set in the editor; name suggests ${want.rankSlug})`)
  }

  if (!g.statusSourceRef || g.statusSourceRef.startsWith('sanity-migration:')) {
    if (parsed.status && g.status !== parsed.status.value) {
      out.push({ text: `${P} SET p.status = $v, p.status_state = 'candidate', p.status_sourceRef = $ref`,
                 params: { id, v: parsed.status.value, ref: sanMigRef('person', id, `name-marker:${parsed.status.marker}`) } })
      summary.push(`status → ${parsed.status.value}`)
    } else if (!parsed.status && g.statusSourceRef) {
      out.push({ text: `${P} REMOVE p.status, p.status_sourceRef SET p.status_state = 'unknown'`, params: { id } })
      summary.push('status removed')
    }
  }

  // Type follows the migration's rank: a parsed rank makes a soldier, the Menig default a civilian.
  const wantType = parsed.rank ? 'soldier' : 'civilian'
  if (migrationRank && !g.adminEdited.includes('type') && g.type !== wantType) {
    out.push({ text: `${P} SET p.type = $v`, params: { id, v: wantType } })
    summary.push(`type → ${wantType}`)
  }

  if (!g.serviceClassSourceRef || g.serviceClassSourceRef.endsWith(':rank-parsed-from-name')) {
    if (parsed.rank && !g.serviceClassSourceRef) {
      out.push({ text: `${P} SET p.serviceClass = 'military', p.serviceClass_state = 'candidate', p.serviceClass_sourceRef = $ref`,
                 params: { id, ref: sanMigRef('person', id, 'rank-parsed-from-name') } })
    } else if (!parsed.rank && g.serviceClassSourceRef) {
      out.push({ text: `${P} REMOVE p.serviceClass, p.serviceClass_state, p.serviceClass_sourceRef`, params: { id } })
    }
  }
  return out
}

/** Replace the person's REFERENCED_IN edges with Sanity's links (only called when the graph's set is Sanity-derived). */
function linksStmt(id: string, d: Doc): Stmt {
  const titles = new Map(((d.links as { link?: string; title?: string }[] | undefined) ?? []).map(l => [l.link ?? '', l.title]))
  const sources = sanityLinks(d).map(url => linkSource(url, titles.get(url)))
  return {
    text: `${P}
           OPTIONAL MATCH (p)-[r:REFERENCED_IN]->(s:Source) WHERE NOT s.id IN $ids DELETE r
           WITH DISTINCT p
           UNWIND $sources AS src
           MERGE (s:Source {id: src.id})
             ON CREATE SET s += src
           MERGE (p)-[:REFERENCED_IN]->(s)`,
    params: { id, ids: sources.map(s => s.id), sources },
  }
}

/** Replace the person's Sanity-CDN HAS_IMAGE edges with Sanity's gallery, in Sanity's order. */
function galleryStmt(id: string, d: Doc): Stmt {
  const images = imageSources(d.gallery).map(i => ({ ...i, caption: i.caption ?? null }))
  return {
    text: `${P}
           OPTIONAL MATCH (p)-[r:HAS_IMAGE]->(s:Source)
             WHERE s.url STARTS WITH 'https://cdn.sanity.io/' AND NOT s.id IN $ids
           DELETE r
           WITH DISTINCT p
           UNWIND $images AS img
           MERGE (s:Source {id: img.id})
             ON CREATE SET s.type = 'photograph', s.url = img.url, s.sanityAssetRef = img.assetRef
           MERGE (p)-[h:HAS_IMAGE]->(s)
           SET h.order = img.order, h.caption = img.caption`,
    params: { id, ids: images.map(i => i.id), images },
  }
}

function descriptionStmt(id: string, slug: string, d: Doc): Stmt {
  return {
    text: `${P}
           OPTIONAL MATCH (p)-[:HAS_CONTENT]->(old:Description) DETACH DELETE old
           WITH DISTINCT p
           CREATE (p)-[:HAS_CONTENT]->(:Description {id: $descId, order: 1, content: $content})
           SET p.description_sourceRef = $ref, p.description_state = 'candidate',
               p.description_sanityUpdatedAt = $updatedAt`,
    params: { id, descId: `desc:person:${slug}:1`, content: JSON.stringify(d.description),
              ref: sanMigRef('person', id, 'description'), updatedAt: d._updatedAt },
  }
}

function stampStmt(id: string, stamps: Record<string, string>): Stmt {
  return { text: `${P} SET p += $stamps`, params: { id, stamps } }
}

// ── Plans ──

/** Graph edits the sync can see on an accepted-review person, per field. */
type Blocked = Map<string, Set<string>>

function planChanged(g: GraphPerson, s: Doc, april: Doc | undefined, skipped: string[], renames: Rename[], blocked: Blocked): Plan | null {
  const verdicts = classify(g, s, april).map(v =>
    v.verdict === 'review' && acceptReview.has(g.slug) && !blocked.get(g.sanityId)?.has(v.field)
      ? { ...v, verdict: 'clean' as const } : v)
  if (!verdicts.length) return null
  const plan: Plan = { sanityId: g.sanityId, slug: g.slug, summary: [], stmts: [] }
  const stamps: Record<string, string> = {}
  const sanitySlug = str((s.slug as { current?: string } | undefined)?.current)
  const slugApplies = verdicts.some(v => v.field === 'slug' && v.verdict === 'clean')
  const finalSlug = slugApplies ? sanitySlug : g.slug

  for (const { field, verdict } of verdicts) {
    const f = fieldByName.get(field)!
    if (verdict === 'conflict' || verdict === 'review') { skipped.push(`${g.slug}: ${field} (${verdict})`); continue }
    if (field === 'slug') {
      if (verdict === 'clean') {
        renames.push({ id: g.sanityId, from: g.slug, to: sanitySlug })
        plan.summary.push(`slug ${g.slug} → ${sanitySlug}`)
      }
      Object.assign(stamps, stampFor(f, s))
      continue
    }
    if (verdict === 'not-imported') {
      if (field === 'description' && hasText(s.description)) {
        plan.stmts.push(descriptionStmt(g.sanityId, finalSlug, s))
        plan.summary.push('description imported')
        Object.assign(stamps, stampFor(f, s))
      }
      continue
    }

    // clean or already
    if (field === 'name') {
      plan.stmts.push(...nameStmts(g.sanityId, str(s.name), verdict === 'clean', g, plan.summary))
      if (verdict === 'clean') plan.summary.push('name')
    } else if (verdict === 'clean') {
      if (field === 'home' || field === 'secretName' || field === 'birthYear') plan.stmts.push(scalarStmt(g.sanityId, field, s[field]))
      if (field === 'links')       plan.stmts.push(linksStmt(g.sanityId, s))
      if (field === 'gallery')     plan.stmts.push(galleryStmt(g.sanityId, s))
      if (field === 'description') plan.stmts.push(descriptionStmt(g.sanityId, finalSlug, s))
      plan.summary.push(field)
    }
    Object.assign(stamps, stampFor(f, s))
  }
  if (Object.keys(stamps).length) plan.stmts.push(stampStmt(g.sanityId, stamps))
  return plan.stmts.length ? plan : null
}

/** Two phases so a chain (A → B while B → C) never holds a slug twice. */
function renameStmts(renames: Rename[]): Stmt[] {
  const phase = (to: (r: Rename) => string): Stmt => ({
    text: `UNWIND $renames AS r
           MATCH (p:Person {sanityId: r.id})
           SET p.slug = r.to
           WITH p
           MATCH (p)-[:HAS_CONTENT]->(d:Description)
           SET d.id = 'desc:person:' + p.slug + ':' + toString(coalesce(d.order, 1))`,
    params: { renames: renames.map(r => ({ id: r.id, to: to(r) })) },
  })
  return [phase(r => `__renaming__${r.id}`), phase(r => r.to)]
}

function planNew(s: Doc): Plan {
  const id = s._id
  const slug = str((s.slug as { current?: string } | undefined)?.current)
  const parsed = parsePerson(str(s.name))
  const rank = rankEdge(id, parsed)
  const stamps = Object.assign({}, ...FIELDS.map(f => stampFor(f, s))) as Record<string, string>
  const stmts: Stmt[] = [
    {
      text: `CREATE (p:Person {sanityId: $id}) SET p += $props
             WITH p MATCH (rk:Rank {slug: $rank})
             CREATE (p)-[:RANK {state: 'candidate', sourceRef: $rankRef}]->(rk)`,
      params: {
        id, rank: rank.rankSlug, rankRef: rank.sourceRef,
        props: {
          slug, canonicalName: parsed.canonicalName, sanityUpdatedAt: s._updatedAt,
          // classify-person-type.ts: a parsed rank makes a soldier; the Menig default does not.
          type: parsed.rank ? 'soldier' : 'civilian',
          ...personClaims(id, s, parsed),
          ...stamps,
        },
      },
    },
    linksStmt(id, s),
    galleryStmt(id, s),
  ]
  if (hasText(s.description)) stmts.push(descriptionStmt(id, slug, s))
  return { sanityId: id, slug, summary: ['new'], stmts }
}

// ── Stamp only (#80) ──

/**
 * Writes the baseline into the graph as per-field stamps, so the sync no longer needs the baseline file
 * (24 MB, local only — CI cannot read it). Changes no data field and moves no SyncState. Dry run unless
 * --write; refuses to write unless every person gets, from its stamps, the verdicts the file gives.
 */
async function stampPeople(graph: Map<string, GraphPerson>, sanity: Map<string, Doc>, april: Map<string, Doc>) {
  if (!april.size) {
    console.error('--stamp needs the baseline file: there is nothing to stamp from.')
    process.exitCode = 1
    return
  }
  const rows = [...graph.values()]
    .map(g => ({ id: g.sanityId, slug: g.slug, stamps: stampsFromBaseline(g, april.get(g.sanityId)) }))
    .filter(r => Object.keys(r.stamps).length)
  const fieldCount = rows.reduce((n, r) => n + Object.keys(r.stamps).filter(k => k.endsWith('_sha')).length, 0)
  const untrusted = [...graph.values()].filter(g => april.get(g.sanityId)?._updatedAt !== g.sanityUpdatedAt && !Object.keys(g.stamps).length).length
  const { checked, differ } = verifyStamps(graph, sanity, april)

  console.log(`Stamp only: ${rows.length} people, ${fieldCount} fields to stamp from the baseline`)
  console.log(`Not stamped: ${untrusted} people with neither a trustworthy baseline nor a stamp (a Sanity change to one goes to review)`)
  console.log(`Check: ${checked} people give the same verdicts from the stamps as from the file${differ.length ? ` — ${differ.length} DIFFER` : ''}`)
  for (const d of differ.slice(0, 5)) console.log(`  ${d.slug}: file ${JSON.stringify(d.withFile)} · stamps ${JSON.stringify(d.withStamps)}`)

  if (!write) { console.log('\n(dry run — pass --write to stamp)'); return }
  if (differ.length) {
    console.error('\nRefusing to write: the stamps must give the same verdicts as the baseline file.')
    process.exitCode = 1
    return
  }
  const driver = neo4jDriver()
  const ws = driver.session()
  try {
    for (let i = 0; i < rows.length; i += 200) {
      await ws.executeWrite(tx => tx.run(`UNWIND $rows AS x MATCH (p:Person {sanityId: x.id}) SET p += x.stamps`,
        { rows: rows.slice(i, i + 200).map(r => ({ id: r.id, stamps: r.stamps })) }))
    }
    console.log(`Stamped ${rows.length} people (${fieldCount} fields).`)
  } finally {
    await ws.close()
    await driver.close()
  }
}

// ── Main ──

async function main() {
  const april = loadApril()
  const [sanityDocs, graph] = await Promise.all([fetchSanityPeople(), fetchGraphPeople()])
  const sanity = new Map(sanityDocs.map(d => [d._id, d]))
  if (stampOnly) return stampPeople(graph, sanity, april)

  // Calibration compares what the rule makes of the baseline with the graph, so it needs the
  // baseline file — a dev-machine check (after a rule change, run sanity-person-fields.ts). Without
  // the file (CI) it is skipped, and says so, instead of passing on zero checks.
  const calib = april.size ? calibrate(graph, sanity, april) : null
  const off = calib ? Object.entries(calib).filter(([, c]) => c.agree !== c.total) : []
  console.log(`Calibration: ${!calib ? 'skipped — no baseline file (the stamps on the nodes are the baseline)' : off.length ? off.map(([n, c]) => `${n} ${c.total - c.agree} differ`).join(', ') : 'rule reproduces the graph (100%)'}`)

  const driver = neo4jDriver()
  const errors: string[] = []
  try {
    // Accepted review people: every slug must have review fields; detectable graph edits block their field.
    const blocked: Blocked = new Map()
    const bySlug = new Map([...graph.values()].map(g => [g.slug, g]))
    for (const slug of acceptReview) {
      const g = bySlug.get(slug)
      const s = g && sanity.get(g.sanityId)
      if (!g || !s || !classify(g, s, april.get(g.sanityId)).some(v => v.verdict === 'review')) {
        errors.push(`--accept-review: ${slug} has no review fields`)
        continue
      }
      const keep = new Set(sanityLinks(s))
      if (g.links.some(l => !keep.has(l))) (blocked.get(g.sanityId) ?? blocked.set(g.sanityId, new Set()).get(g.sanityId)!).add('links')
    }
    if (acceptReview.size) {
      const rs = driver.session({ defaultAccessMode: neo4j.session.READ })
      const edited = await rs.run(`
        UNWIND $slugs AS slug
        MATCH (p:Person {slug: slug})-[h:HAS_IMAGE]->(s:Source)
        WHERE s.url STARTS WITH 'https://cdn.sanity.io/' AND any(k IN keys(h) WHERE NOT k IN ['order', 'caption'])
        RETURN DISTINCT p.sanityId AS id`, { slugs: [...acceptReview] })
      await rs.close()
      for (const rec of edited.records) {
        const id = rec.get('id') as string
        ;(blocked.get(id) ?? blocked.set(id, new Set()).get(id)!).add('gallery')
      }
    }

    const skipped: string[] = []
    const renames: Rename[] = []
    const changed = [...graph.values()]
      .map(g => sanity.get(g.sanityId) ? planChanged(g, sanity.get(g.sanityId)!, april.get(g.sanityId), skipped, renames, blocked) : null)
      .filter((p): p is Plan => !!p)
    const created = sanityDocs.filter(d => !graph.has(d._id)).map(planNew)
    const deletions = await planDeletions(driver, new Map([...graph.values()].map(g => [g.sanityId, g.slug])), sanity)
    const deleted = deletions.filter(d => acceptDelete.has(d.slug))
    for (const slug of acceptDelete) {
      const d = deletions.find(x => x.slug === slug)
      if (!d) errors.push(`--accept-delete: ${slug} is not deleted in Sanity`)
      else if (d.blockers.length) errors.push(`--accept-delete: ${slug} has graph edits: ${d.blockers.join('; ')}`)
    }
    for (const [id, fields] of blocked) skipped.push(`${graph.get(id)!.slug}: ${[...fields].join(', ')} (graph edits — accept-review blocked)`)

    // New people must resolve.
    const session = driver.session({ defaultAccessMode: neo4j.session.READ })
    // Every Person slug after the renames, plus the new people, must be unique.
    const all = await session.run(`MATCH (p:Person) RETURN p.slug AS slug, coalesce(p.sanityId, elementId(p)) AS id`)
    const owner = new Map<string, string>(all.records.map(rec => [rec.get('id') as string, rec.get('slug') as string]))
    for (const r of renames) owner.set(r.id, r.to)
    for (const c of created) owner.set(c.sanityId, c.slug)
    const seen = new Map<string, string>()
    for (const [id, slug] of owner) {
      if (seen.has(slug)) errors.push(`slug held twice after sync: ${slug} (${seen.get(slug)}, ${id})`)
      seen.set(slug, id)
    }
    const ranks = [...new Set(created.map(c => c.stmts[0].params.rank as string))]
    const rr = await session.run(`UNWIND $ranks AS r OPTIONAL MATCH (k:Rank {slug: r}) RETURN r, k IS NOT NULL AS ok`, { ranks })
    for (const rec of rr.records) if (!rec.get('ok')) errors.push(`rank missing: ${rec.get('r')}`)
    for (const c of created) if (!c.slug) errors.push(`no slug: ${c.sanityId}`)
    for (const r of renames) if (!/^[a-z0-9-]+$/.test(r.to)) errors.push(`odd slug: ${r.from} → ${r.to}`)
    await session.close()

    const fieldCounts: Record<string, number> = {}
    for (const p of changed) for (const s of p.summary) fieldCounts[s.split(' ')[0]] = (fieldCounts[s.split(' ')[0]] ?? 0) + 1
    console.log(`\nChanged people to apply: ${changed.length}`)
    for (const [k, n] of Object.entries(fieldCounts).sort()) console.log(`  ${k.padEnd(12)} ${n}`)
    console.log(`Slug renames: ${renames.length}`)
    console.log(`New people: ${created.length} (${created.filter(c => c.stmts.length === 4).length} with description)`)
    console.log(`Left alone: ${skipped.length} field(s) — see plan file`)
    console.log(`Deleted in Sanity: ${deletions.length} (${deleted.length} accepted)`)
    for (const d of deletions) console.log(`  ${acceptDelete.has(d.slug) ? '✓' : ' '} ${deletionSummary(d)}`)
    if (errors.length) console.log(`\nErrors (${errors.length}):\n  ${errors.join('\n  ')}`)

    mkdirSync(resolve(OUT, '..'), { recursive: true })
    writeFileSync(OUT, JSON.stringify({
      generatedAt: new Date().toISOString(), calibration: calib, errors, skipped, renames,
      changed: changed.map(p => ({ slug: p.slug, summary: p.summary })),
      deletions: deletions.map(d => ({ ...d, accepted: acceptDelete.has(d.slug) })),
      created: created.map(p => ({ slug: p.slug, name: p.stmts[0].params.props && (p.stmts[0].params.props as { canonicalName: string }).canonicalName, rank: p.stmts[0].params.rank })),
    }, null, 2) + '\n')
    console.log(`Plan: ${OUT}`)

    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }
    if (off.length || errors.length) {
      console.error('\nRefusing to write: calibration must be 100% and there must be no errors.')
      process.exitCode = 1
      return
    }

    const ws = driver.session()
    const snap = await ws.run(`
      UNWIND $ids AS id
      MATCH (p:Person {sanityId: id})
      RETURN id, properties(p) AS props,
             [(p)-[h:RANK|HELD_RANK]->(k) | {type: type(h), rank: k.slug, props: properties(h)}] AS ranks,
             [(p)-[:REFERENCED_IN]->(s) | s.id] AS links,
             [(p)-[h:HAS_IMAGE]->(s) | {id: s.id, props: properties(h)}] AS images,
             [(p)-[:HAS_CONTENT]->(d) | properties(d)] AS descriptions`,
      { ids: changed.map(c => c.sanityId) })
    const snapDeleted = await ws.run(`
      UNWIND $ids AS id
      MATCH (p:Person {sanityId: id})
      RETURN id, properties(p) AS props,
             [(p)-[r]-(o) | {type: type(r), out: startNode(r) = p, other: coalesce(o.slug, o.id), otherSanityId: o.sanityId, props: properties(r)}] AS edges,
             [(p)-[:HAS_CONTENT]->(d) | properties(d)] AS descriptions`,
      { ids: deleted.map(d => d.sanityId) })
    const snapFile = resolve(OUT, '..', `person-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(snapFile, JSON.stringify({
      created: created.map(c => c.sanityId),
      changed: snap.records.map(r => r.toObject()),
      deleted: snapDeleted.records.map(r => r.toObject()),
    }, null, 2) + '\n')
    console.log(`\nSnapshot of ${snap.records.length} changed, ${snapDeleted.records.length} deleted people: ${snapFile}`)

    let done = 0
    try {
      if (renames.length) {
        await ws.executeWrite(async (tx: ManagedTransaction) => {
          for (const s of renameStmts(renames)) await tx.run(s.text, s.params)
        })
        console.log(`Renamed ${renames.length} slugs.`)
      }
      for (const plan of [...changed, ...created]) {
        await ws.executeWrite(async (tx: ManagedTransaction) => {
          for (const s of plan.stmts) await tx.run(s.text, s.params)
        })
        done++
      }
      for (const d of deleted) {
        await ws.executeWrite(async (tx: ManagedTransaction) => {
          for (const s of deletionStmts(d)) await tx.run(s.text, s.params)
        })
      }
      if (deleted.length) console.log(`Deleted ${deleted.length} people.`)
      const newest = sanityDocs.map(d => d._updatedAt).reduce((a, b) => (b > a ? b : a))
      await ws.run(`
        MERGE (s:SyncState {source: 'sanity', type: 'person'})
        SET s.importedUpTo = $newest, s.at = datetime()`, { newest })
      console.log(`\nApplied ${done} people. SyncState person.importedUpTo = ${newest}`)
    } catch (e) {
      console.error(`\nStopped after ${done} people:`, e)
      process.exitCode = 1
    } finally {
      await ws.close()
    }
  } finally {
    await driver.close()
  }
}
void main().catch(e => { console.error(e); process.exit(1) })
