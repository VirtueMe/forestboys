/**
 * Read-only Neo4j connection for browser queries.
 * Uses the VITE_NEO4J_* env vars (read-only user, never admin credentials).
 *
 * Write operations (e.g. review approve/reject) go through
 * /api/review-item — a Cloudflare Pages Function that holds write credentials.
 */

import neo4j, { type Driver, type RecordShape } from 'neo4j-driver'

let driver: Driver | null = null

function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      import.meta.env['VITE_NEO4J_URI'] as string,
      neo4j.auth.basic(
        import.meta.env['VITE_NEO4J_READER'] as string,
        import.meta.env['VITE_NEO4J_READER_PASSWORD'] as string,
      ),
      { disableLosslessIntegers: true },
    )
  }
  return driver
}

export async function neo4jQuery<T extends RecordShape>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ })
  try {
    const result = await session.run(cypher, params)
    return result.records.map(r => r.toObject() as T)
  } finally {
    await session.close()
  }
}
