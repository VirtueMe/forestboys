<template>
  <div class="source-picker">
    <input
      v-if="!creating"
      v-model="query"
      class="picker-input"
      type="text"
      :placeholder="placeholder ?? 'Søk kilde…'"
      @focus="open = true"
      @blur="onBlur"
    />

    <div v-if="open && !creating" class="picker-results">
      <button
        v-for="r in results"
        :key="r.id"
        type="button"
        class="picker-result"
        @mousedown.prevent="select(r)"
      >
        <span class="picker-title">{{ r.title || r.id }}</span>
        <span v-if="r.authorFreeText" class="picker-author">{{ r.authorFreeText }}</span>
        <span v-if="r.url" class="picker-url">{{ shortUrl(r.url) }}</span>
      </button>
      <button
        type="button"
        class="picker-create"
        @mousedown.prevent="startCreate"
      >
        + Opprett ny kilde<span v-if="query"> «{{ query }}»</span>
      </button>
    </div>

    <form v-if="creating" class="create-form" @submit.prevent="submitCreate">
      <div class="create-title">Ny kilde</div>
      <input
        v-model="form.title"
        class="picker-input"
        type="text"
        placeholder="Tittel *"
        required
        autofocus
      />
      <input
        v-model="form.url"
        class="picker-input"
        type="url"
        placeholder="URL"
      />
      <input
        v-model="form.authorFreeText"
        class="picker-input"
        type="text"
        placeholder="Forfatter"
      />
      <select v-model="form.type" class="picker-input">
        <option value="website">Nettside</option>
        <option value="book">Bok</option>
        <option value="article">Artikkel</option>
        <option value="archive">Arkiv</option>
      </select>
      <div v-if="createError" class="create-error">{{ createError }}</div>
      <div class="create-actions">
        <button type="button" class="create-btn-cancel" @click="cancelCreate">Avbryt</button>
        <button type="submit" class="create-btn-save" :disabled="busy || !form.title.trim()">
          {{ busy ? 'Oppretter…' : 'Opprett' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { authFetch } from '@/composables/useAuth.ts'

interface SourceHit {
  id:             string
  title:          string | null
  url:            string | null
  authorFreeText: string | null
}

defineProps<{ placeholder?: string }>()
const emit = defineEmits<{ pick: [source: SourceHit] }>()

const query   = ref('')
const results = ref<SourceHit[]>([])
const open    = ref(false)

const creating    = ref(false)
const busy        = ref(false)
const createError = ref<string | null>(null)
const form = ref<{ title: string; url: string; authorFreeText: string; type: string }>({
  title: '', url: '', authorFreeText: '', type: 'website',
})

let timer: number | undefined
watch(query, q => {
  window.clearTimeout(timer)
  if (q.length < 2) { results.value = []; return }
  timer = window.setTimeout(async () => {
    try {
      const rows = await neo4jQuery<SourceHit>(`
        MATCH (s:Source)
        WHERE s.title IS NOT NULL AND toLower(s.title) CONTAINS toLower($q)
        RETURN s.id AS id, s.title AS title, s.url AS url, s.authorFreeText AS authorFreeText
        ORDER BY s.title
        LIMIT 12
      `, { q })
      results.value = rows
    } catch {
      results.value = []
    }
  }, 150)
})

function select(r: SourceHit) {
  emit('pick', r)
  query.value = ''
  results.value = []
  open.value = false
}

function onBlur() {
  window.setTimeout(() => { if (!creating.value) open.value = false }, 150)
}

function startCreate() {
  form.value = { title: query.value.trim(), url: '', authorFreeText: '', type: 'website' }
  creating.value = true
  open.value = false
}

function cancelCreate() {
  creating.value = false
  createError.value = null
}

async function submitCreate() {
  busy.value = true
  createError.value = null
  try {
    const res = await authFetch('/api/admin/sources', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        title:          form.value.title.trim(),
        url:            form.value.url.trim() || undefined,
        authorFreeText: form.value.authorFreeText.trim() || undefined,
        type:           form.value.type,
      }),
    })
    const body = await res.json().catch(() => ({})) as Partial<SourceHit> & { error?: string }
    if (!res.ok || !body.id) {
      createError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    emit('pick', {
      id:             body.id,
      title:          body.title          ?? null,
      url:            body.url            ?? null,
      authorFreeText: body.authorFreeText ?? null,
    })
    creating.value = false
    query.value = ''
  } catch (e) {
    createError.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

function shortUrl(url: string): string {
  try { return new URL(url).host.replace(/^www\./, '') }
  catch { return url }
}
</script>

<style scoped>
.source-picker {
  position: relative;
  flex: 1;
}

.picker-input {
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-sizing: border-box;
  font-family: inherit;
}
.picker-input:focus {
  outline: 2px solid var(--color-navy);
  outline-offset: -1px;
  border-color: var(--color-navy);
}

.picker-results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 320px;
  overflow-y: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 10;
}

.picker-result {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 2px 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--color-text);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  text-align: left;
}
.picker-result:hover { background: var(--color-bg); }

.picker-title  { grid-column: 1; grid-row: 1; font-weight: 600; }
.picker-author { grid-column: 1; grid-row: 2; font-size: 11px; color: var(--color-muted); }
.picker-url    { grid-column: 2; grid-row: 1 / 3; align-self: center; font-size: 10px; font-family: monospace; color: var(--color-muted); }

.picker-create {
  width: 100%;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-navy);
  background: var(--color-bg);
  border: none;
  cursor: pointer;
  text-align: left;
}
.picker-create:hover { background: var(--color-navy); color: #fff; }

/* ── Create form ────────────────────────────────────────────── */
.create-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-navy);
  border-radius: 4px;
}

.create-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-navy);
  margin-bottom: 2px;
}

.create-error {
  font-size: 11px;
  color: #b91c1c;
}

.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
}

.create-btn-cancel,
.create-btn-save {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  border: none;
  font-family: inherit;
}
.create-btn-cancel {
  background: transparent;
  color: var(--color-muted);
  border: 1px solid var(--color-border);
}
.create-btn-save {
  background: var(--color-navy);
  color: #fff;
}
.create-btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
