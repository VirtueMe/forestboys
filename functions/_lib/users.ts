/**
 * Accounts and their roles (D1 `users`), for the admin review of access
 * requests. Sign-in creates the row as `pending` (functions/_lib/oauth.ts);
 * an admin moves it to `editor`, `admin` or `denied` here.
 */

export const ROLES = ['pending', 'editor', 'admin', 'denied'] as const
export type Role = typeof ROLES[number]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

export interface UserRow {
  id:         string
  email:      string
  name:       string | null
  role:       Role
  provider:   string | null
  created_at: string
  last_login: string
}

/** Why a role change is refused, or null when it is fine. */
export function checkRoleChange(
  target:     { role: string },
  next:       Role,
  adminCount: number,
): string | null {
  if (target.role === next) return `Kontoen har allerede rollen ${next}.`
  if (target.role === 'admin' && next !== 'admin' && adminCount <= 1) {
    return 'Dette er den siste administratoren. Gjør en annen til administrator først.'
  }
  return null
}

/** Pending requests first, then editors and admins, denied last; newest first within a group. */
export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const { results } = await db.prepare(`
    SELECT id, email, name, role, provider, created_at, last_login
    FROM users
    ORDER BY CASE role WHEN 'pending' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
             created_at DESC
  `).all<UserRow>()
  return results
}

export type SetRoleResult = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string }

export async function setUserRole(db: D1Database, id: string, next: unknown): Promise<SetRoleResult> {
  if (!isRole(next)) return { ok: false, status: 400, error: `Ugyldig rolle. Bruk: ${ROLES.join(', ')}.` }

  const target = await db.prepare('SELECT role FROM users WHERE id = ?').bind(id).first<{ role: string }>()
  if (!target) return { ok: false, status: 404, error: 'Fant ikke kontoen.' }

  const admins = await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).first<{ n: number }>()
  const refusal = checkRoleChange(target, next, admins?.n ?? 0)
  if (refusal) return { ok: false, status: 409, error: refusal }

  await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(next, id).run()
  return { ok: true }
}
