/**
 * Make the local graph the same as production.
 *
 *   npx tsx scripts/tools/pull-production.ts            counts of both, changes nothing
 *   npx tsx scripts/tools/pull-production.ts --write    empties the local graph, copies production into it
 *
 * Production is only ever read (.env.production, PRODUCTION_NEO4J_*); the target is
 * always the local Neo4j of .env, which loadEnv() insists is localhost. The copy
 * keeps labels, properties, relationship types and properties, constraints and
 * indexes. Node and relationship ids are not kept; a temporary label and property
 * (__Copy, __pid) tie the relationships to their nodes while it runs and are removed.
 */
import { readFileSync } from 'node:fs'
import * as dotenv from 'dotenv'
import neo4j, { type Driver, type Session } from 'neo4j-driver'
import { WRITE, loadEnv, productionBanner } from '../lib/env.ts'

const BATCH = 2000

const { host: localHost } = loadEnv()

const prodEnv = dotenv.parse(readFileSync('.env.production'))
const prodUri = prodEnv.PRODUCTION_NEO4J_URI ?? prodEnv.NEO4J_URI
const prodUser = prodEnv.PRODUCTION_NEO4J_USERNAME ?? prodEnv.NEO4J_USERNAME
const prodPass = prodEnv.PRODUCTION_NEO4J_PASSWORD ?? prodEnv.NEO4J_PASSWORD
if (!prodUri || !prodUser || !prodPass) { console.error('.env.production has no production Neo4j connection.'); process.exit(2) }
const prodHost = prodUri.replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
if (/^(localhost|127\.0\.0\.1|::1)$/.test(prodHost)) { console.error(`.env.production points at ${prodHost}.`); process.exit(2) }
console.error(productionBanner(prodHost, false))
console.error(`▶ LOCAL ${localHost}${WRITE ? ' — WRITING (the local graph is emptied first)' : ' — read only'}`)

const prod: Driver  = neo4j.driver(prodUri, neo4j.auth.basic(prodUser, prodPass))
const local: Driver = neo4j.driver(process.env.NEO4J_URI!, neo4j.auth.basic(process.env.NEO4J_USERNAME ?? 'neo4j', process.env.NEO4J_PASSWORD ?? ''))

type Row = Record<string, unknown>
const num = (v: unknown): number => neo4j.isInt(v) ? (v as { toNumber(): number }).toNumber() : Number(v)

async function rows(s: Session, cypher: string, params: Row = {}): Promise<Row[]> {
  const r = await s.run(cypher, params)
  return r.records.map(rec => rec.toObject())
}

async function census(d: Driver): Promise<{ labels: Map<string, number>; rels: Map<string, number>; nodes: number; relCount: number }> {
  const s = d.session()
  try {
    const labels = new Map<string, number>()
    for (const r of await rows(s, 'MATCH (n) UNWIND (CASE WHEN size(labels(n)) = 0 THEN ["(none)"] ELSE labels(n) END) AS l RETURN l, count(*) AS c')) labels.set(String(r.l), num(r.c))
    const rels = new Map<string, number>()
    for (const r of await rows(s, 'MATCH ()-[r]->() RETURN type(r) AS t, count(*) AS c')) rels.set(String(r.t), num(r.c))
    const [{ n }] = await rows(s, 'MATCH (n) RETURN count(n) AS n')
    const [{ n: relCount }] = await rows(s, 'MATCH ()-[r]->() RETURN count(r) AS n')
    return { labels, rels, nodes: num(n), relCount: num(relCount) }
  } finally { await s.close() }
}

function diff(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = []
  for (const k of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) out.push(`  ${k.padEnd(28)} production ${String(a.get(k) ?? 0).padStart(7)}   local ${String(b.get(k) ?? 0).padStart(7)}`)
  }
  return out
}

function report(title: string, p: Awaited<ReturnType<typeof census>>, l: Awaited<ReturnType<typeof census>>): boolean {
  const dl = diff(p.labels, l.labels)
  const dr = diff(p.rels, l.rels)
  console.log(`${title}: production ${p.nodes} nodes / ${p.relCount} relationships, local ${l.nodes} / ${l.relCount}`)
  if (dl.length) console.log('Labels that differ:\n' + dl.join('\n'))
  if (dr.length) console.log('Relationship types that differ:\n' + dr.join('\n'))
  return p.nodes === l.nodes && p.relCount === l.relCount && !dl.length && !dr.length
}

async function schemaStatements(d: Driver): Promise<string[]> {
  const s = d.session()
  try {
    const out: string[] = []
    for (const r of await rows(s, 'SHOW CONSTRAINTS YIELD name, createStatement')) out.push(String(r.createStatement))
    // Indexes that back a constraint come with the constraint.
    for (const r of await rows(s, "SHOW INDEXES YIELD name, type, owningConstraint, createStatement WHERE type <> 'LOOKUP' AND owningConstraint IS NULL")) out.push(String(r.createStatement))
    return out
  } finally { await s.close() }
}

async function wipeLocal(): Promise<void> {
  const s = local.session()
  try {
    for (const r of await rows(s, 'SHOW CONSTRAINTS YIELD name')) await s.run(`DROP CONSTRAINT \`${String(r.name)}\``)
    for (const r of await rows(s, "SHOW INDEXES YIELD name, type WHERE type <> 'LOOKUP'")) await s.run(`DROP INDEX \`${String(r.name)}\` IF EXISTS`)
    await s.run('MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 5000 ROWS')
  } finally { await s.close() }
}

async function copyNodes(): Promise<number> {
  const ps = prod.session({ defaultAccessMode: neo4j.session.READ })
  const ls = local.session()
  let last = -1
  let total = 0
  try {
    await ls.run('CREATE INDEX tmp_copy_pid IF NOT EXISTS FOR (n:__Copy) ON (n.__pid)')
    for (;;) {
      const batch = await rows(ps, 'MATCH (n) WHERE id(n) > $last RETURN id(n) AS id, labels(n) AS labels, properties(n) AS props ORDER BY id(n) LIMIT $limit', { last: neo4j.int(last), limit: neo4j.int(BATCH) })
      if (!batch.length) break
      await ls.run(
        'UNWIND $rows AS row CALL apoc.create.node(row.labels + ["__Copy"], apoc.map.setKey(row.props, "__pid", row.id)) YIELD node RETURN count(node)',
        { rows: batch.map(r => ({ id: num(r.id), labels: r.labels, props: r.props })) },
      )
      last = num(batch[batch.length - 1].id)
      total += batch.length
      process.stderr.write(`\r  nodes ${total}`)
    }
    process.stderr.write('\n')
    return total
  } finally { await ps.close(); await ls.close() }
}

async function copyRelationships(): Promise<number> {
  const ps = prod.session({ defaultAccessMode: neo4j.session.READ })
  const ls = local.session()
  let last = -1
  let total = 0
  try {
    for (;;) {
      const batch = await rows(ps, 'MATCH (a)-[r]->(b) WHERE id(r) > $last RETURN id(r) AS id, type(r) AS type, id(a) AS s, id(b) AS e, properties(r) AS props ORDER BY id(r) LIMIT $limit', { last: neo4j.int(last), limit: neo4j.int(BATCH) })
      if (!batch.length) break
      await ls.run(
        'UNWIND $rows AS row MATCH (a:__Copy {__pid: row.s}), (b:__Copy {__pid: row.e}) CALL apoc.create.relationship(a, row.type, row.props, b) YIELD rel RETURN count(rel)',
        { rows: batch.map(r => ({ s: num(r.s), e: num(r.e), type: r.type, props: r.props })) },
      )
      last = num(batch[batch.length - 1].id)
      total += batch.length
      process.stderr.write(`\r  relationships ${total}`)
    }
    process.stderr.write('\n')
    return total
  } finally { await ps.close(); await ls.close() }
}

async function main(): Promise<void> {
  const p0 = await census(prod)
  const l0 = await census(local)
  const same = report('Before', p0, l0)
  if (!WRITE) {
    console.log(same ? 'The two already agree.' : 'Dry run. Pass --write to empty the local graph and copy production into it.')
    return
  }

  const statements = await schemaStatements(prod)
  console.log(`Emptying the local graph (${l0.nodes} nodes)…`)
  await wipeLocal()
  console.log('Copying…')
  const n = await copyNodes()
  const r = await copyRelationships()

  const ls = local.session()
  try {
    await ls.run('MATCH (n:__Copy) CALL (n) { REMOVE n:__Copy REMOVE n.__pid } IN TRANSACTIONS OF 5000 ROWS')
    await ls.run('DROP INDEX tmp_copy_pid IF EXISTS')
    console.log(`Schema: ${statements.length} statements from production`)
    for (const st of statements) {
      try { await ls.run(st) } catch (e) { console.error(`  FAILED: ${st}\n    ${(e as Error).message}`); process.exitCode = 1 }
    }
  } finally { await ls.close() }

  const ok = report('After ', await census(prod), await census(local))
  console.log(`Copied ${n} nodes and ${r} relationships.`)
  if (!ok) { console.error('The counts still differ.'); process.exitCode = 1 }
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prod.close(); await local.close() })
