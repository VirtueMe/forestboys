/**
 * Who is making this request, with a role that is current.
 *
 * A bearer JWT (direct login) is trusted as signed. A session cookie is
 * signed too, but it was minted at sign-in and lives for 30 days, so the
 * role inside it can be stale: an approval or a demotion would not apply
 * until the next sign-in. For cookie sessions the role, name and email are
 * therefore read from D1 on every request, and an account that no longer
 * exists is treated as signed out.
 */

import { readSession, type SessionUser } from './session.ts'
import { verifyJwt }                     from './jwt.ts'

export interface UserEnv {
  SESSION_SECRET: string
  /** Absent in tests and when the binding is missing: the cookie's role is used. */
  milorg_users?:  D1Database
}

export async function resolveUser(request: Request, env: UserEnv): Promise<SessionUser | null> {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (bearer) {
    const claims = await verifyJwt(bearer, env.SESSION_SECRET)
    if (claims) return { id: claims.sub, email: claims.email, name: claims.name, role: claims.role }
  }

  const session = await readSession(request, env.SESSION_SECRET)
  if (!session || !env.milorg_users) return session

  const row = await env.milorg_users
    .prepare('SELECT email, name, role FROM users WHERE id = ?')
    .bind(session.id)
    .first<{ email: string; name: string | null; role: string }>()
  if (!row) return null
  return { id: session.id, email: row.email, name: row.name ?? session.name, role: row.role }
}
