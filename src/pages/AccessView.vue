<template>
  <div class="access-page">
    <div class="access-card">
      <div class="wip-banner">Under utvikling — ikke klar til bruk</div>
      <h1 class="access-title">Redaktørtilgang</h1>

      <div v-if="loading" class="access-state">
        <p class="state-text muted">Laster…</p>
      </div>

      <!-- Not logged in -->
      <div v-else-if="!user" class="access-state">
        <p v-if="oauthError" class="oauth-error" role="alert">{{ oauthError }}</p>
        <div class="access-section">
          <p class="section-label">Allerede redaktør?</p>
          <a :href="authHref('google')" class="btn btn-google">
            <svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Logg inn med Google
          </a>
          <a :href="authHref('github')" class="btn btn-google btn-github">
            <svg class="provider-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
            </svg>
            Logg inn med GitHub
          </a>
        </div>

        <div v-if="directEnabled" class="section-divider">eller</div>

        <div v-if="directEnabled" class="access-section">
          <p class="section-label">Logg inn med brukernavn</p>
          <p class="state-text muted">For deg som har fått egne innloggings-detaljer av oss.</p>
          <form class="direct-form" @submit.prevent="submitLogin">
            <input
              v-model="username"
              class="direct-input"
              type="text"
              autocomplete="username"
              placeholder="Brukernavn"
              :disabled="busy"
              aria-label="Brukernavn"
            />
            <input
              v-model="password"
              class="direct-input"
              type="password"
              autocomplete="current-password"
              placeholder="Passord"
              :disabled="busy"
              aria-label="Passord"
            />
            <button
              type="submit"
              class="btn btn-direct"
              :disabled="busy || !username || !password"
            >
              {{ busy ? 'Logger inn…' : 'Logg inn' }}
            </button>
          </form>
          <p v-if="error" class="direct-error">{{ error }}</p>
        </div>

        <div class="section-divider">eller</div>

        <div class="access-section">
          <p class="section-label">Vil du bli redaktør?</p>
          <p class="state-text">
            Be om tilgang ved å logge inn med Google- eller GitHub-kontoen din.
            En administrator vil godkjenne forespørselen.
          </p>
          <a :href="authHref('google')" class="btn btn-google">
            <svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Be om tilgang med Google
          </a>
          <a :href="authHref('github')" class="btn btn-google btn-github">
            <svg class="provider-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
            </svg>
            Be om tilgang med GitHub
          </a>
        </div>
      </div>

      <!-- Pending -->
      <div v-else-if="user.role === 'pending'" class="access-state">
        <div class="status-badge status-pending">Venter på godkjenning</div>
        <p class="state-text">
          Innlogget som <strong>{{ user.name }}</strong> ({{ user.email }}).<br />
          Forespørselen din er sendt — en administrator vil godkjenne den snart.
        </p>
        <button class="btn btn-secondary" type="button" @click="logout">Logg ut</button>
      </div>

      <!-- Denied -->
      <div v-else-if="user.role === 'denied'" class="access-state">
        <div class="status-badge status-denied">Tilgang avvist</div>
        <p class="state-text">
          Tilgang som redaktør ble ikke innvilget for <strong>{{ user.email }}</strong>.
        </p>
        <button class="btn btn-secondary" type="button" @click="logout">Logg ut</button>
      </div>

      <!-- Editor or admin -->
      <div v-else class="access-state">
        <div class="status-badge status-active">
          {{ user.role === 'admin' ? 'Administrator' : 'Redaktør' }}
        </div>
        <p class="state-text">
          Innlogget som <strong>{{ user.name }}</strong> ({{ user.email }}).
        </p>
        <div class="access-actions">
          <RouterLink :to="nextPath ?? '/'" class="btn btn-primary">
            {{ nextPath ? 'Fortsett' : 'Til forsiden' }}
          </RouterLink>
          <button class="btn btn-secondary" type="button" @click="logout">Logg ut</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth.ts'
import { parseFailureDetail } from '../utils/failureDetail.ts'

const { user, loading, directLogin, logout } = useAuth()
const route  = useRoute()
const router = useRouter()

const nextPath = computed(() => {
  const raw = route.query.next
  const str = Array.isArray(raw) ? raw[0] : raw
  return typeof str === 'string' && str.startsWith('/') ? str : null
})

/** Sign-in start, keeping where to return to (functions/_lib/oauth.ts carries it through state). */
function authHref(provider: 'google' | 'github'): string {
  return nextPath.value ? `/auth/${provider}?next=${encodeURIComponent(nextPath.value)}` : `/auth/${provider}`
}

const PROVIDER_LABEL: Record<string, string> = { google: 'Google', github: 'GitHub' }

/** Short code from the failing step, e.g. `token:incorrect_client_credentials`. */
const failureDetail = computed<string | null>(() => parseFailureDetail(route.query.detail))

/** Why an OAuth sign-in came back to /access (accessError() in functions/_lib/oauth.ts). */
const oauthError = computed<string | null>(() => {
  const code = typeof route.query.error === 'string' ? route.query.error : null
  const provider = PROVIDER_LABEL[typeof route.query.provider === 'string' ? route.query.provider : ''] ?? 'den andre leverandøren'
  switch (code) {
    case 'provider':   return `Denne e-posten er registrert med ${provider} — logg inn med ${provider}.`
    case 'unverified': return 'Kontoen har ingen bekreftet e-postadresse. Bekreft e-posten hos leverandøren og prøv igjen.'
    case 'state':      return 'Innloggingen ble avbrutt eller har gått ut på tid. Prøv igjen.'
    case 'denied':     return 'Innloggingen ble avbrutt.'
    case 'failed':     return `Innloggingen mislyktes. Prøv igjen.${failureDetail.value ? ` (feilkode: ${failureDetail.value})` : ''}`
    default:           return null
  }
})

watch(user, u => {
  if (u && (u.role === 'admin' || u.role === 'editor') && nextPath.value) {
    void router.replace(nextPath.value)
  }
})

// Direct login — username/password exchange for a JWT bearer token, a
// provisional alternative to Google OAuth while we wait for Jan to decide
// whether to commit to Google. The section is hidden when the server reports
// `enabled: false` (i.e. DIRECT_LOGIN_USERNAME / DIRECT_LOGIN_PASSWORD_HASH
// aren't set on the Pages env).
const directEnabled = ref(false)
const username = ref('')
const password = ref('')
const busy     = ref(false)
const error    = ref<string | null>(null)

onMounted(async () => {
  try {
    const res = await fetch('/auth/token')
    if (!res.ok) return
    const data = await res.json() as { enabled: boolean }
    directEnabled.value = Boolean(data.enabled)
  } catch { /* endpoint missing — feature off */ }
})

async function submitLogin() {
  busy.value  = true
  error.value = null
  const err = await directLogin({ username: username.value, password: password.value })
  if (err) {
    error.value = err
  } else {
    username.value = ''
    password.value = ''
  }
  busy.value = false
}
</script>

<style scoped>
.access-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: var(--paper);
}

.access-card {
  width: 100%;
  max-width: 420px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 12px;
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.wip-banner {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #92400e;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  padding: 6px 10px;
  text-align: center;
}

.access-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
  margin: 0;
}

.access-state {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.state-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink);
  margin: 0;
}
.state-text.muted { color: var(--muted); }

.status-badge {
  display: inline-flex;
  align-self: flex-start;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 20px;
}
.status-pending { background: #fff8e1; color: #b45309; }
.status-denied  { background: #fef2f2; color: #b91c1c; }
.status-active  { background: #f0fdf4; color: #15803d; }

.access-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.access-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

.section-divider {
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  position: relative;
}

.section-divider::before,
.section-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: calc(50% - 20px);
  height: 1px;
  background: var(--rule);
}

.section-divider::before { left: 0; }
.section-divider::after  { right: 0; }

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  text-decoration: none;
  transition: opacity 0.1s;
}
.btn:hover { opacity: 0.85; }

.btn-google {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  color: var(--ink);
  width: 100%;
  justify-content: center;
  padding: 11px 16px;
}

.btn-primary {
  background: var(--focus);
  color: #fff;
}

.btn-secondary {
  background: var(--rule);
  color: var(--ink);
}

.btn-github { margin-top: var(--space-sm); }
.provider-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.oauth-error {
  margin: 0 0 var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  color: var(--danger);
  font-size: var(--size-label);
}
.google-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.direct-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.direct-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--rule);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink);
  box-sizing: border-box;
}
.direct-input:focus {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
  border-color: var(--focus);
}
.direct-input:disabled { opacity: 0.6; }

.btn-direct {
  background: var(--focus);
  color: #fff;
  width: 100%;
  justify-content: center;
  padding: 11px 16px;
}
.btn-direct:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.direct-error {
  margin: 0;
  font-size: 12px;
  color: #b91c1c;
}
</style>
