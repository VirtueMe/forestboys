<template>
  <div class="admin-users">
    <header class="header">
      <h1 class="title">Brukere</h1>
    </header>

    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="loadError" class="status error">{{ loadError }}</div>
    <template v-else>
      <p v-if="actionError" class="status error" role="alert">{{ actionError }}</p>

      <section v-for="group in groups" :key="group.role" class="group">
        <h2 class="group-title">
          {{ group.label }} <span class="group-count">{{ group.users.length }}</span>
        </h2>
        <p v-if="!group.users.length" class="empty">{{ group.empty }}</p>
        <ul v-else class="list">
          <li v-for="u in group.users" :key="u.id" class="row">
            <div class="row-main">
              <div class="row-head">
                <span class="row-name">{{ u.name || u.email }}</span>
                <span class="row-provider">{{ providerLabel(u.provider) }}</span>
                <span v-if="u.id === me?.id" class="row-you">deg</span>
              </div>
              <div class="row-meta">
                <span>{{ u.email }}</span>
                <span :title="u.created_at">Opprettet {{ day(u.created_at) }}</span>
                <span :title="u.last_login">Sist innlogget {{ day(u.last_login) }}</span>
              </div>
            </div>
            <div class="row-actions">
              <button
                v-for="action in actionsFor(u)"
                :key="action.role"
                type="button"
                :class="action.primary ? 'btn-primary' : 'btn-ghost'"
                :disabled="busyId === u.id"
                @click="setRole(u, action.role)"
              >
                {{ action.label }}
              </button>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { authFetch, useAuth } from '@/composables/useAuth.ts'
import { pendingCount } from '@/composables/usePendingRequests.ts'

type Role = 'pending' | 'editor' | 'admin' | 'denied'

interface Row {
  id:         string
  email:      string
  name:       string | null
  role:       Role
  provider:   string | null
  created_at: string
  last_login: string
}

const { user: me } = useAuth()

const users       = ref<Row[]>([])
const loading     = ref(true)
const loadError   = ref<string | null>(null)
const actionError = ref<string | null>(null)
const busyId      = ref<string | null>(null)

const GROUPS: { role: Role; label: string; empty: string }[] = [
  { role: 'pending', label: 'Ber om tilgang',  empty: 'Ingen forespørsler venter.' },
  { role: 'admin',   label: 'Administratorer', empty: 'Ingen administratorer.' },
  { role: 'editor',  label: 'Redaktører',      empty: 'Ingen redaktører ennå.' },
  { role: 'denied',  label: 'Avvist',          empty: 'Ingen er avvist.' },
]

const groups = computed(() => GROUPS.map(g => ({ ...g, users: users.value.filter(u => u.role === g.role) })))

function providerLabel(p: string | null): string {
  return p === 'github' ? 'GitHub' : 'Google'   // rows from before the provider column are Google
}

function day(iso: string): string {
  return iso.slice(0, 10)
}

function actionsFor(u: Row): { role: Role; label: string; primary?: boolean }[] {
  switch (u.role) {
    case 'pending': return [{ role: 'editor', label: 'Godkjenn som redaktør', primary: true }, { role: 'denied', label: 'Avvis' }]
    case 'editor':  return [{ role: 'admin', label: 'Gjør til administrator' }, { role: 'denied', label: 'Fjern tilgang' }]
    case 'admin':   return [{ role: 'editor', label: 'Gjør til redaktør' }]
    default:        return [{ role: 'pending', label: 'Åpne igjen' }]
  }
}

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const res = await authFetch('/api/admin/users')
    const body = await res.json() as { users?: Row[]; pending?: number; error?: string }
    if (!res.ok) { loadError.value = body.error ?? `HTTP ${res.status}`; return }
    users.value = body.users ?? []
    pendingCount.value = body.pending ?? 0
  } catch (e) {
    loadError.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function setRole(u: Row, role: Role) {
  actionError.value = null
  if (role === 'denied' && !window.confirm(`Fjern tilgangen til ${u.name || u.email}?`)) return
  busyId.value = u.id
  try {
    const res = await authFetch(`/api/admin/users/${encodeURIComponent(u.id)}/role`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ role }),
    })
    const body = await res.json().catch(() => ({})) as { error?: string }
    if (!res.ok) { actionError.value = body.error ?? `HTTP ${res.status}`; return }
    u.role = role
    pendingCount.value = users.value.filter(x => x.role === 'pending').length
  } catch (e) {
    actionError.value = (e as Error).message
  } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<style scoped>
.admin-users {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--paper);
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
}

.header { margin-bottom: 20px; }
.title  { font-size: 20px; margin: 0; color: var(--ink); }

.status { padding: 12px 0; font-size: 13px; color: var(--muted); }
.error  { color: var(--faded-red); }

.group { margin-bottom: 28px; }
.group-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 8px;
}
.group-count {
  margin-left: 6px;
  padding: 1px 7px;
  font-size: 11px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 8px;
}
.empty { font-size: 13px; color: var(--muted); margin: 0; }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }

.row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  padding: 12px 14px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 6px;
}

.row-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.row-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.row-provider {
  font-size: 10px;
  font-family: monospace;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.row-you { font-size: 11px; color: var(--muted); padding: 1px 6px; background: var(--paper); border-radius: 8px; }

.row-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; font-size: 12px; color: var(--muted); }

.row-actions { display: flex; gap: 6px; align-self: flex-start; flex-wrap: wrap; justify-content: flex-end; }

.btn-ghost,
.btn-primary {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--rule);
  font-family: inherit;
}
.btn-ghost { background: transparent; color: var(--ink); }
.btn-ghost:hover:not(:disabled) { border-color: var(--focus); color: var(--focus); }
.btn-primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.btn-primary:hover:not(:disabled) { opacity: 0.88; }
.btn-ghost:disabled,
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

@media (max-width: 640px) {
  .admin-users { padding: 16px; }
  .row { grid-template-columns: 1fr; }
  .row-actions { justify-content: flex-start; }
}
</style>
