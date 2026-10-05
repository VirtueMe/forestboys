<template>
  <div class="admin-changelog">
    <header class="header">
      <h1 class="title">Endringslogg</h1>
      <p class="lead">
        Hvor mange utgivelser <router-link to="/endringslogg">endringsloggen</router-link>
        viser, og hvor mange «Vis flere» henter om gangen.
      </p>
    </header>

    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="loadError" class="status error">{{ loadError }}</div>
    <form v-else class="form" @submit.prevent="save">
      <label class="field">
        <span class="label">Vis først</span>
        <input v-model.number="initial" class="input" type="number" min="1" max="100" step="1" required />
      </label>
      <label class="field">
        <span class="label">Vis flere henter</span>
        <input v-model.number="step" class="input" type="number" min="1" max="100" step="1" required />
      </label>

      <p v-if="saveError" class="status error" role="alert">{{ saveError }}</p>
      <p v-else-if="saved" class="status ok" role="status">Lagret.</p>

      <div>
        <button type="submit" class="btn-primary" :disabled="saving || !dirty">Lagre</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'

const URL = '/api/admin/site-settings/changelog'

const initial   = ref(5)
const step      = ref(5)
const stored    = ref({ initial: 5, step: 5 })
const loading   = ref(true)
const loadError = ref<string | null>(null)
const saving    = ref(false)
const saveError = ref<string | null>(null)
const saved     = ref(false)

const dirty = computed(() => initial.value !== stored.value.initial || step.value !== stored.value.step)

function apply(s: { initial: number; step: number }) {
  stored.value  = { ...s }
  initial.value = s.initial
  step.value    = s.step
}

async function load() {
  try {
    const res  = await authFetch(URL)
    const body = await res.json() as { initial?: number; step?: number; error?: string }
    if (!res.ok || body.initial === undefined || body.step === undefined) {
      loadError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    apply({ initial: body.initial, step: body.step })
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
      body:    JSON.stringify({ initial: initial.value, step: step.value }),
    })
    const body = await res.json() as { initial?: number; step?: number; error?: string }
    if (!res.ok || body.initial === undefined || body.step === undefined) {
      saveError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    apply({ initial: body.initial, step: body.step })
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
.admin-changelog {
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

.form  { display: flex; flex-direction: column; gap: 16px; max-width: 280px; }
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
  .admin-changelog { padding: 16px; }
}
</style>
