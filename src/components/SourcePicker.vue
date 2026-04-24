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
        @blur="autoFill"
      />
      <input
        v-model="form.authorFreeText"
        class="picker-input"
        type="text"
        placeholder="Forfatter"
      />
      <div class="form-row">
        <select v-model="form.type" class="picker-input">
          <option value="website">Nettside</option>
          <option value="book">Bok</option>
          <option value="article">Artikkel</option>
          <option value="archive">Arkiv</option>
        </select>
        <LicensePicker v-model="form.license" />
      </div>
      <input v-model="form.attribution" class="picker-input" type="text" placeholder="Attribusjon (for gjenbruk)" />
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
import { licenseForUrl, attributionForUrl, NOASSERTION, type License } from '@/utils/licenseForDomain.ts'
import LicensePicker from '@/components/LicensePicker.vue'

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
const form = ref<{
  title:          string
  url:            string
  authorFreeText: string
  type:           string
  license:        License
  attribution:    string
}>({
  title: '', url: '', authorFreeText: '', type: 'website',
  license: NOASSERTION, attribution: '',
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
  form.value = {
    title:          query.value.trim(),
    url:            '',
    authorFreeText: '',
    type:           'website',
    license:        NOASSERTION,
    attribution:    '',
  }
  creating.value = true
  open.value = false
}

function autoFill() {
  if (!form.value.url) return
  if (form.value.license === NOASSERTION) form.value.license = licenseForUrl(form.value.url)
  if (!form.value.attribution) {
    const attr = attributionForUrl(form.value.url)
    if (attr) form.value.attribution = attr
  }
}

function cancelCreate() {
  creating.value = false
  createError.value = null
}

async function submitCreate() {
  autoFill() // fires even if the URL input didn't blur before submit
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
        license:        form.value.license,
        attribution:    form.value.attribution.trim() || undefined,
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
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}
.picker-input:focus {
  outline: 1px solid var(--focus);
  outline-offset: 0;
  border-color: var(--focus);
}

.picker-results {
  position: absolute;
  top: calc(100% + var(--space-xs));
  left: 0;
  right: 0;
  max-height: 320px;
  overflow-y: auto;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 10;
}

.picker-result {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: var(--space-xs) var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
  text-align: left;
}
.picker-result:hover { background: var(--paper-sunken); }

.picker-title  { grid-column: 1; grid-row: 1; font-weight: 500; }
.picker-author { grid-column: 1; grid-row: 2; font-size: var(--size-label); color: var(--muted); }
.picker-url    { grid-column: 2; grid-row: 1 / 3; align-self: center; font-size: var(--size-caps); font-family: var(--font-mono); color: var(--muted); }

.picker-create {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--faded-red);
  background: var(--paper-sunken);
  border: none;
  cursor: pointer;
  text-align: left;
}
.picker-create:hover { background: var(--faded-red); color: var(--paper); }

/* ── Create form ────────────────────────────────────────────── */
.create-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--paper-raised);
  border: 1px solid var(--focus);
  border-radius: var(--radius-md);
}

.create-title {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--ink-soft);
  margin-bottom: var(--space-xs);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}

.create-error {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}

.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}

.create-btn-cancel,
.create-btn-save {
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  border-radius: var(--radius-md);
  cursor: pointer;
  border: none;
}
.create-btn-cancel {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--rule);
}
.create-btn-cancel:hover { background: var(--paper-sunken); }
.create-btn-save {
  background: var(--faded-red);
  color: var(--paper);
}
.create-btn-save:hover:not(:disabled) { background: var(--faded-red-soft); }
.create-btn-save:disabled { background: var(--paper-sunken); color: var(--muted); cursor: not-allowed; }
</style>
