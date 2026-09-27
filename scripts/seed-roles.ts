/**
 * One-shot: create :Role nodes from the role vocabularies that used to be
 * hard-coded (ROLE_LABEL / PART_OF_ROLE_LABEL in relation/strategies.ts,
 * VALID_ROLES in organization/[slug]/units.ts). See docs/ROLES.md.
 *
 * - Keys match what edges already store, so existing `role` values keep
 *   resolving. Names are the current Norwegian labels. No descriptions —
 *   those are written on /admin/roles, with sources.
 * - Before writing, every `role` value on every scoped edge type is
 *   checked against the seed. Any value without a matching role in that
 *   scope is reported and the run aborts (bulk-op rule: zero unexplained).
 * - Idempotent: MERGE on key; re-running only fills missing roles and
 *   adds missing scopes, never overwrites a name edited on the page.
 *
 * Usage: npx tsx scripts/seed-roles.ts [--dry]
 */

import neo4j from 'neo4j-driver'
import * as dotenv from 'dotenv'
dotenv.config()

const dry = process.argv.includes('--dry')

// Must match functions/_lib/role-scopes.ts.
const SCOPE_EDGES: Record<string, string> = {
  'membership': 'MEMBER_OF',
  'part-of':    'PART_OF',
  'stationed':  'STATIONED_AT',
  'crew':       'CREW_OF',
}

const SEED: Array<{ key: string; name: string; scopes: string[] }> = [
  // Person → Unit / Organization
  { key: 'operative',      name: 'operatør',         scopes: ['membership'] },
  { key: 'courier',        name: 'kurér',            scopes: ['membership'] },
  { key: 'radiotelegraph', name: 'radiotelegrafist', scopes: ['membership'] },
  { key: 'host',           name: 'vert',             scopes: ['membership'] },
  { key: 'informant',      name: 'informant',        scopes: ['membership'] },
  { key: 'member',         name: 'medlem',           scopes: ['membership'] },
  // Unit → Organization
  { key: 'administrative', name: 'administrativt',   scopes: ['part-of'] },
  { key: 'operational',    name: 'operativt',        scopes: ['part-of'] },
  { key: 'sponsor',        name: 'sponsor',          scopes: ['part-of'] },
  { key: 'parent',         name: 'overordnet',       scopes: ['part-of'] },
  // Person → Location / Station (docs/PERSON-STATIONED-AT.md, R4)
  { key: 'stationed',      name: 'stasjonert',       scopes: ['stationed'] },
  { key: 'hiding',         name: 'i skjul',          scopes: ['stationed'] },
  { key: 'imprisoned',     name: 'fange',            scopes: ['stationed'] },
  { key: 'training',       name: 'opplæring',        scopes: ['stationed'] },
  { key: 'operating',      name: 'operatør',         scopes: ['stationed'] },
]

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
  )
  const session = driver.session()
  try {
    // 1. Every role value in use, per scope, must be covered by the seed.
    const unexplained: string[] = []
    for (const [scope, edge] of Object.entries(SCOPE_EDGES)) {
      const r = await session.run(
        `MATCH ()-[x:${edge}]->() WHERE x.role IS NOT NULL
         RETURN x.role AS role, count(*) AS n ORDER BY role`)
      for (const rec of r.records) {
        const role = rec.get('role') as string
        const n    = rec.get('n').toNumber() as number
        const ok   = SEED.some(s => s.key === role && s.scopes.includes(scope))
        console.log(`  ${ok ? '✓' : '✗'} ${scope.padEnd(10)} ${role} (${n})`)
        if (!ok) unexplained.push(`${scope}:${role} (${n})`)
      }
    }
    if (unexplained.length) {
      console.error(`\nUnexplained role values — add them to SEED first:\n  ${unexplained.join('\n  ')}`)
      process.exitCode = 1
      return
    }

    const existing = await session.run(`MATCH (r:Role) RETURN r.key AS key`)
    const have = new Set(existing.records.map(r => r.get('key') as string))
    const missing = SEED.filter(s => !have.has(s.key))
    console.log(`\nRoles in seed: ${SEED.length} · already present: ${have.size} · to create: ${missing.length}`)

    if (dry) { console.log('(dry run — no writes)'); return }

    await session.run(`CREATE CONSTRAINT role_key IF NOT EXISTS FOR (r:Role) REQUIRE r.key IS UNIQUE`)
    const res = await session.run(`
      UNWIND $seed AS s
      MERGE (r:Role {key: s.key})
        ON CREATE SET r.name = s.name, r.scopes = s.scopes
        ON MATCH  SET r.scopes = r.scopes + [x IN s.scopes WHERE NOT x IN r.scopes]
      RETURN count(r) AS n
    `, { seed: SEED })
    console.log(`Merged ${res.records[0]?.get('n')} roles.`)
  } finally {
    await session.close()
    await driver.close()
  }
}
void main().catch(e => { console.error(e); process.exit(1) })
