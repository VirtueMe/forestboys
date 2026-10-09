<template>
  <div class="admin-site">
    <header class="header">
      <h1 class="title">Innstillinger</h1>
      <p class="lead">Innstillinger for nettstedet.</p>
    </header>

    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="loadError" class="status error">{{ loadError }}</div>
    <form v-else class="form" @submit.prevent="save">
      <fieldset class="group">
        <legend class="group-title">Navn</legend>
        <p class="hint">
          Det fulle navnet brukes i fanetittelen og av den installerte appen;
          kortnavnet brukes i menyen øverst.
        </p>
        <label class="field">
          <span class="label">Navn</span>
          <input v-model="name" class="input" type="text" maxlength="60" required />
        </label>
        <label class="field">
          <span class="label">Kortnavn</span>
          <input v-model="shortName" class="input" type="text" maxlength="24" required />
        </label>
      </fieldset>

      <p v-if="saveError" class="status error" role="alert">{{ saveError }}</p>
      <p v-else-if="saved" class="status ok" role="status">Lagret. Åpne siden på nytt for å se det i fanen.</p>

      <div>
        <button type="submit" class="btn-primary" :disabled="saving || !dirty">Lagre</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'

const URL = '/api/admin/site-settings/site'

interface Names { name: string; shortName: string }

const name      = ref('')
const shortName = ref('')
const stored    = ref<Names>({ name: '', shortName: '' })
const loading   = ref(true)
const loadError = ref<string | null>(null)
const saving    = ref(false)
const saveError = ref<string | null>(null)
const saved     = ref(false)

const dirty = computed(() => name.value !== stored.value.name || shortName.value !== stored.value.shortName)

function apply(s: Names) {
  stored.value    = { ...s }
  name.value      = s.name
  shortName.value = s.shortName
}

async function load() {
  try {
    const res  = await authFetch(URL)
    const body = await res.json() as Partial<Names> & { error?: string }
    if (!res.ok || body.name === undefined || body.shortName === undefined) {
      loadError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    apply({ name: body.name, shortName: body.shortName })
  } catch (e) {
    loadError.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  saveError.value = null
  saved.value = false
  try {
    const res  = await authFetch(URL, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: name.value, shortName: shortName.value }),
    })
    const body = await res.json() as Partial<Names> & { error?: string }
    if (!res.ok || body.name === undefined || body.shortName === undefined) {
      saveError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    apply({ name: body.name, shortName: body.shortName })
    saved.value = true
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.admin-site {
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
.title  { font-size: 20px; margin: 0 0 6px; color: var(--ink); }
.lead   { margin: 0; font-size: 13px; color: var(--muted); }
.lead a { color: var(--focus); }

.status { padding: 4px 0; font-size: 13px; color: var(--muted); }
.error  { color: var(--faded-red); }
.ok     { color: var(--ink-soft); }

.form  { display: flex; flex-direction: column; gap: 16px; max-width: 360px; }
.group {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0;
  padding: 14px 16px 16px;
  border: 1px solid var(--rule);
  border-radius: 4px;
}
.group-title { padding: 0 6px; font-size: 13px; font-weight: 600; color: var(--ink); }
.hint  { margin: 0; font-size: 12px; color: var(--muted); }
.field { display: flex; flex-direction: column; gap: 4px; }
.label { font-size: 12px; font-weight: 600; color: var(--ink); }
.input {
  padding: 6px 8px;
  font: inherit;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 4px;
}
.input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

.btn-primary {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  border-radius: 4px;
  cursor: pointer;
  background: var(--ink);
  color: var(--paper);
  border: 1px solid var(--ink);
}
.btn-primary:hover:not(:disabled) { opacity: 0.88; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

@media (max-width: 640px) {
  .admin-site { padding: 16px; }
}
</style>
