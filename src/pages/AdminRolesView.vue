<template>
  <div class="admin-roles">
    <header class="header">
      <h1 class="title">Roller</h1>
      <div class="header-tools">
        <select v-model="scopeFilter" class="filter" aria-label="Filtrer på gruppe">
          <option value="">Alle grupper</option>
          <option v-for="s in scopes" :key="s" :value="s">{{ scopeLabel(s) }}</option>
        </select>
        <button v-if="!creating" type="button" class="btn-ghost" @click="startCreate">+ Ny rolle</button>
      </div>
    </header>

    <div v-if="creating" class="create-slot">
      <RoleEditForm
        :scopes="scopes"
        :taken-keys="roles.map(r => r.key)"
        @saved="onCreated"
        @cancel="creating = false"
      />
    </div>

    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="error" class="status error">{{ error }}</div>
    <p v-else-if="!visible.length" class="status">Ingen roller{{ scopeFilter ? ' i denne gruppen' : '' }}.</p>
    <ul v-else class="list">
      <li v-for="r in visible" :key="r.key" class="row">
        <div class="row-main">
          <span class="row-name">{{ r.name }}</span>
          <code class="row-key">{{ r.key }}</code>
          <span v-for="s in r.scopes" :key="s" class="row-scope" :title="`${usage(r, s)} koblinger`">
            {{ scopeLabel(s) }}<span class="row-scope-count"> · {{ usage(r, s) }}</span>
          </span>
          <span v-if="!r.hasDescription" class="row-nodesc">mangler beskrivelse</span>
        </div>
        <div class="row-actions">
          <button type="button" class="btn-ghost" @click="toggleEdit(r.key)">Rediger</button>
          <button
            type="button"
            class="btn-delete"
            :disabled="totalUsage(r) > 0 || deletingKey === r.key"
            :title="totalUsage(r) > 0 ? 'Rollen brukes og kan ikke slettes' : 'Slett'"
            @click="confirmDelete(r)"
          >
            {{ deletingKey === r.key ? 'Sletter…' : 'Slett' }}
          </button>
        </div>
        <div v-if="editingKey === r.key" class="row-edit">
          <RoleEditForm
            :role="r"
            :scopes="scopes"
            :taken-keys="[]"
            @saved="onSaved"
            @description="onDescription"
            @cancel="editingKey = null"
          />
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * AdminRolesView — /admin/roles. Relation roles as data (docs/ROLES.md):
 * name, groups (scopes), and a sourced description visitors will see.
 * Usage counts come from the server, which owns the scope → edge map.
 * Delete / removing a group is only possible while nothing uses it.
 */
import { ref, computed } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import { scopeLabel } from '@/utils/roleScopes.ts'
import { invalidateRoles } from '@/composables/useRoles.ts'
import RoleEditForm, { type RoleRow } from '@/components/role/RoleEditForm.vue'

const roles       = ref<RoleRow[]>([])
const scopes      = ref<string[]>([])
const loading     = ref(true)
const error       = ref<string | null>(null)
const creating    = ref(false)
const editingKey  = ref<string | null>(null)
const deletingKey = ref<string | null>(null)
const scopeFilter = ref('')

async function load() {
  loading.value = true
  error.value   = null
  try {
    const res  = await authFetch('/api/admin/roles')
    const body = await res.json() as { roles?: RoleRow[]; scopes?: string[]; error?: string }
    if (!res.ok) { error.value = body.error ?? `HTTP ${res.status}`; return }
    roles.value  = body.roles ?? []
    scopes.value = body.scopes ?? []
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
void load()

const visible = computed(() =>
  [...roles.value]
    .filter(r => !scopeFilter.value || r.scopes.includes(scopeFilter.value))
    .sort((a, b) => a.name.localeCompare(b.name, 'nb')),
)

const usage      = (r: RoleRow, s: string) => r.usage?.[s] ?? 0
const totalUsage = (r: RoleRow) => Object.values<number>(r.usage ?? {}).reduce((a, b) => a + b, 0)

function startCreate() {
  editingKey.value = null
  creating.value   = true
}

function toggleEdit(key: string) {
  creating.value   = false
  editingKey.value = editingKey.value === key ? null : key
}

function onCreated(r: RoleRow) {
  roles.value.push(r)
  invalidateRoles()
  creating.value = false
  // Straight into edit so the description can be written right away.
  editingKey.value = r.key
}

function onSaved(r: RoleRow) {
  const row = roles.value.find(x => x.key === r.key)
  if (row) Object.assign(row, r)
  invalidateRoles()
}

function onDescription(key: string, has: boolean) {
  const row = roles.value.find(x => x.key === key)
  if (row) row.hasDescription = has
  invalidateRoles()
}

async function confirmDelete(r: RoleRow) {
  if (totalUsage(r) > 0) return
  if (!window.confirm(`Slett rollen «${r.name}»?`)) return
  deletingKey.value = r.key
  try {
    const res = await authFetch(`/api/admin/roles/${encodeURIComponent(r.key)}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    roles.value = roles.value.filter(x => x.key !== r.key)
    invalidateRoles()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    deletingKey.value = null
  }
}
</script>

<style scoped>
.admin-roles {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--paper);
  padding: var(--space-lg);
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  flex-wrap: wrap;
  margin-bottom: var(--space-lg);
}
.title { font-size: 24px; font-weight: 700; color: var(--focus); margin: 0; }
.header-tools { display: flex; align-items: center; gap: var(--space-sm); }
.filter {
  padding: 6px 10px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 4px;
}

.create-slot { margin-bottom: var(--space-lg); }
.status { padding: var(--space-lg); font-size: var(--size-label); color: var(--muted); text-align: center; }
.error  { color: var(--danger); }

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-md);
  padding: 10px 14px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}
.row-main { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
.row-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.row-key  { font-family: var(--font-mono); font-size: var(--size-mono); color: var(--muted); }
.row-scope {
  font-size: 11px;
  color: var(--ink-soft);
  padding: 1px 6px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 8px;
}
.row-scope-count { color: var(--muted); font-variant-numeric: tabular-nums; }
.row-nodesc { font-size: 11px; font-style: italic; color: var(--muted); }

.row-actions { display: flex; gap: 6px; align-self: flex-start; }
.btn-ghost,
.btn-delete {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink);
  font-family: inherit;
}
.btn-ghost:hover { border-color: var(--focus); color: var(--focus); }
.btn-delete { color: var(--danger); }
.btn-delete:hover:not(:disabled) { border-color: var(--danger); }
.btn-delete:disabled { opacity: 0.4; cursor: not-allowed; }

.row-edit { grid-column: 1 / -1; }
</style>
