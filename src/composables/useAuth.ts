import { ref, onMounted } from 'vue'

export interface AuthUser {
  id:    string
  email: string
  name:  string
  role:  'pending' | 'editor' | 'admin' | 'denied'
}

const TOKEN_KEY = 'milorg_access_token'

const user    = ref<AuthUser | null>(null)
const loading = ref(true)
const token   = ref<string | null>(
  typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null,
)

function setToken(next: string | null) {
  token.value = next
  if (typeof localStorage === 'undefined') return
  if (next) localStorage.setItem(TOKEN_KEY, next)
  else      localStorage.removeItem(TOKEN_KEY)
}

/**
 * Fetch helper that injects the Bearer token from localStorage when present.
 * Exported so API callers (e.g. review-item) send the same credential the
 * cookie path would.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {})
  if (token.value && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token.value}`)
  }
  return fetch(input, { ...init, headers, credentials: 'include' })
}

async function fetchUser(): Promise<void> {
  try {
    const res = await authFetch('/auth/me')
    if (res.ok) {
      user.value = await res.json() as AuthUser
    } else {
      if (res.status === 401) setToken(null)   // expired / revoked
      user.value = null
    }
  } catch {
    user.value = null
  } finally {
    loading.value = false
  }
}

export interface LoginCredentials { username: string; password: string }

/**
 * Exchange username + password for a JWT bearer token. Stores it in
 * localStorage and refetches the user so the rest of the app reacts.
 * Returns null on success, an error message on failure.
 */
export async function directLogin(creds: LoginCredentials): Promise<string | null> {
  const res = await fetch('/auth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(creds),
  })
  if (res.status === 401) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    return body.error ?? 'Feil brukernavn eller passord.'
  }
  if (!res.ok) return `Innlogging feilet (HTTP ${res.status}).`

  const data = await res.json() as { access_token: string }
  if (!data.access_token) return 'Svar manglet token.'
  setToken(data.access_token)
  await fetchUser()
  return null
}

export async function logout(): Promise<void> {
  setToken(null)
  user.value = null
  try { await fetch('/auth/logout', { method: 'POST', credentials: 'include' }) } catch { /* ignore */ }
  loading.value = false
}

export function useAuth() {
  onMounted(() => {
    if (loading.value) void fetchUser()
  })

  return { user, loading, token, refetch: fetchUser, directLogin, logout }
}
