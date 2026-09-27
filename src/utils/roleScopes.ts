/**
 * Norwegian labels for role scopes. The scope → edge mapping itself lives
 * server-side (functions/_lib/role-scopes.ts); the admin API returns the
 * scope list, and this only names them. Unknown scopes fall back to key.
 */
export const ROLE_SCOPE_LABEL: Record<string, string> = {
  'membership': 'Medlemskap',
  'part-of':    'Enhet i organisasjon',
  'stationed':  'Stasjonert på',
  'crew':       'Mannskap',
}

export const scopeLabel = (scope: string): string => ROLE_SCOPE_LABEL[scope] ?? scope
