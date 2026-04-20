<template>
  <div class="admin-sources">
    <header class="header">
      <h1 class="title">Kilder</h1>
      <input
        v-model="query"
        type="search"
        placeholder="Søk tittel…"
        class="search"
      />
    </header>

    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="error" class="status error">{{ error }}</div>
    <template v-else>
      <div class="meta">{{ total }} treff</div>
      <ul class="list">
        <li v-for="row in rows" :key="row.id" class="row">
          <div class="row-main">
            <div class="row-head">
              <span class="row-title">{{ row.title || row.id }}</span>
              <span class="row-type">{{ row.type || '—' }}</span>
              <span
                class="row-usage"
                :class="{ 'usage-zero': row.usage === 0 }"
                :title="`Referert fra ${row.usage} sted(er)`"
              >{{ row.usage }} bruk</span>
            </div>
            <div class="row-meta">
              <span v-if="row.authorFreeText" class="row-author">{{ row.authorFreeText }}</span>
              <a
                v-if="row.url"
                :href="row.url"
                target="_blank"
                rel="noopener noreferrer"
                class="row-url"
              >{{ row.url }} ↗</a>
            </div>
          </div>
          <div class="row-actions">
            <button type="button" class="btn-ghost" @click="startEdit(row)">Rediger</button>
            <button
              type="button"
              class="btn-delete"
              :disabled="row.usage > 0 || deletingId === row.id"
              :title="row.usage > 0 ? 'Kilden brukes og kan ikke slettes' : 'Slett'"
              @click="confirmDelete(row)"
            >
              {{ deletingId === row.id ? 'Sletter…' : 'Slett' }}
            </button>
          </div>
          <div v-if="editingId === row.id" class="row-edit">
            <SourceEditForm
              :source="row"
              @saved="onSaved"
              @cancel="editingId = null"
            />
          </div>
        </li>
      </ul>

      <nav v-if="total > limit" class="pager">
        <button class="pager-btn" :disabled="offset === 0" @click="prev">‹ Forrige</button>
        <span class="pager-range">{{ offset + 1 }}–{{ Math.min(offset + limit, total) }} av {{ total }}</span>
        <button class="pager-btn" :disabled="offset + limit >= total" @click="next">Neste ›</button>
      </nav>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import SourceEditForm from '@/components/SourceEditForm.vue'

interface Row {
  id:             string
  title:          string | null
  url:            string | null
  authorFreeText: string | null
  type:           string | null
  usage:          number
}

const query     = ref('')
const limit     = 50
const offset    = ref(0)
const rows      = ref<Row[]>([])
const total     = ref(0)
const loading   = ref(true)
const error     = ref<string | null>(null)
const editingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)

let searchTimer: number | undefined

async function load() {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset.value) })
    if (query.value) params.set('q', query.value)
    const res = await authFetch(`/api/admin/sources?${params}`)
    const body = await res.json() as { rows?: Row[]; total?: number; error?: string }
    if (!res.ok) {
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    rows.value  = body.rows ?? []
    total.value = body.total ?? 0
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

watch(query, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    offset.value = 0
    void load()
  }, 200)
})

void load()

function next() { offset.value += limit; void load() }
function prev() { offset.value = Math.max(0, offset.value - limit); void load() }

function startEdit(row: Row) {
  editingId.value = editingId.value === row.id ? null : row.id
}

function onSaved(updated: { id: string; title: string | null; url: string | null; authorFreeText: string | null }) {
  const r = rows.value.find(x => x.id === updated.id)
  if (r) {
    r.title          = updated.title
    r.url            = updated.url
    r.authorFreeText = updated.authorFreeText
  }
  editingId.value = null
}

async function confirmDelete(row: Row) {
  if (row.usage > 0) return
  if (!window.confirm(`Slett "${row.title || row.id}"?`)) return

  deletingId.value = row.id
  try {
    const res = await authFetch(`/api/admin/sources/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    rows.value = rows.value.filter(r => r.id !== row.id)
    total.value = Math.max(0, total.value - 1)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    deletingId.value = null
  }
}
</script>

<style scoped>
.admin-sources {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-navy);
  margin: 0;
}

.search {
  flex: 1;
  max-width: 320px;
  padding: 9px 12px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-family: inherit;
  box-sizing: border-box;
}
.search:focus { outline: 2px solid var(--color-navy); outline-offset: -1px; border-color: var(--color-navy); }

.status { padding: 24px; font-size: 13px; color: var(--color-muted); text-align: center; }
.error  { color: var(--color-red, #b91c1c); }

.meta {
  font-size: 11px;
  color: var(--color-muted);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  padding: 12px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.row-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.row-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.row-type {
  font-size: 10px;
  font-family: monospace;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.row-usage {
  font-size: 11px;
  color: var(--color-muted);
  padding: 1px 6px;
  background: var(--color-bg);
  border-radius: 8px;
}
.row-usage.usage-zero { color: #b45309; background: #fef3c7; }

.row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-muted);
}

.row-author { }
.row-url {
  color: var(--color-navy);
  text-decoration: underline;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360px;
}

.row-actions {
  display: flex;
  gap: 6px;
  align-self: flex-start;
}

.btn-ghost,
.btn-delete {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
}
.btn-ghost:hover  { border-color: var(--color-navy); color: var(--color-navy); }

.btn-delete { color: #b91c1c; }
.btn-delete:hover:not(:disabled) { background: #fef2f2; border-color: #fecaca; }
.btn-delete:disabled { opacity: 0.4; cursor: not-allowed; }

.row-edit { grid-column: 1 / -1; }

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
}

.pager-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text);
}
.pager-btn:hover:not(:disabled) { border-color: var(--color-navy); }
.pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.pager-range {
  font-size: 11px;
  color: var(--color-muted);
  font-family: monospace;
}
</style>
