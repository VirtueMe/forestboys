<template>
  <section class="edit-section">
    <h3 class="edit-section-heading">Grunnleggende</h3>
    <div class="edit-row">
      <label class="edit-label">Type</label>
      <div class="type-seg">
        <label class="type-seg-opt" :class="{ active: draft.type === 'civilian' }">
          <input v-model="draft.type" type="radio" value="civilian" />
          Sivil
        </label>
        <label class="type-seg-opt" :class="{ active: draft.type === 'soldier' }">
          <input v-model="draft.type" type="radio" value="soldier" />
          Soldat
        </label>
      </div>
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-canonicalName">Navn</label>
      <input id="edit-canonicalName" v-model="draft.canonicalName" class="edit-input" type="text" required />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-secretName">Dekknavn</label>
      <input id="edit-secretName" v-model="draft.secretName" class="edit-input" type="text" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-birthYear">Fødselsår</label>
      <input
        id="edit-birthYear"
        v-model="draft.birthYear"
        class="edit-input edit-input-narrow"
        type="text"
        inputmode="numeric"
        placeholder="åååå"
      />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-home">Hjemsted</label>
      <input id="edit-home" v-model="draft.home" class="edit-input" type="text" />
    </div>
  </section>

  <footer v-if="dirty" class="edit-save-bar">
    <span class="edit-save-prompt">Ser det bra ut?</span>
    <button type="button" class="edit-btn-primary" :disabled="saving" @click="save">
      {{ saving ? 'Lagrer…' : 'Lagre' }}
    </button>
    <button type="button" class="edit-link-revert" :disabled="saving" @click="revert">Angre</button>
  </footer>
  <div v-if="error" class="edit-save-error">{{ error }}</div>
</template>

<script setup lang="ts">
/**
 * PersonScalarEditor — Grunnleggende edit form (canonicalName, secretName,
 * birthYear, home, type). Owns its own draft + save logic. Emits `saved`
 * with the server's response so the parent can update its neo4jPerson ref.
 *
 * The draft + dirty flag are exposed via defineExpose so the parent's
 * overlay computed (`person.value` with editForm overlaid) can render the
 * unsaved values in the preview tab while still in edit mode.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import type { PersonType } from './types.ts'

interface Saved {
  name:       string
  secretName: string | null
  birthYear:  number | null
  home:       string | null
  type:       PersonType | null
}

interface SaveResponse {
  canonicalName?: string
  secretName?:    string | null
  birthYear?:     number | null
  home?:          string | null
  type?:          PersonType
  error?:         string
}

export interface ScalarDraft {
  canonicalName: string
  secretName:    string
  birthYear:     string
  home:          string
  type:          PersonType
}

const props = defineProps<{
  slug:  string
  saved: Saved
}>()

const emit = defineEmits<{ saved: [updates: SaveResponse] }>()

const empty: ScalarDraft = { canonicalName: '', secretName: '', birthYear: '', home: '', type: 'civilian' }
const draft    = ref<ScalarDraft>({ ...empty })
const baseline = ref<ScalarDraft>({ ...empty })
const saving   = ref(false)
const error    = ref<string | null>(null)

function snapshot() {
  const snap: ScalarDraft = {
    canonicalName: props.saved.name ?? '',
    secretName:    props.saved.secretName ?? '',
    birthYear:     props.saved.birthYear != null ? String(props.saved.birthYear) : '',
    home:          props.saved.home ?? '',
    type:          props.saved.type ?? 'civilian',
  }
  draft.value    = { ...snap }
  baseline.value = { ...snap }
  error.value    = null
}
watch(() => props.saved, snapshot, { immediate: true, deep: true })

const dirty = computed(() =>
  (Object.keys(draft.value) as (keyof ScalarDraft)[]).some(k => draft.value[k] !== baseline.value[k]),
)

function revert() {
  draft.value = { ...baseline.value }
  error.value = null
}

async function save() {
  saving.value = true
  error.value  = null
  try {
    const body: Record<string, unknown> = {}
    const f = draft.value, b = baseline.value
    if (f.canonicalName !== b.canonicalName) body.canonicalName = f.canonicalName.trim()
    if (f.secretName    !== b.secretName)    body.secretName    = f.secretName.trim() || null
    if (f.home          !== b.home)          body.home          = f.home.trim() || null
    if (f.type          !== b.type)          body.type          = f.type
    if (f.birthYear     !== b.birthYear) {
      const trimmed = f.birthYear.trim()
      if (!trimmed) body.birthYear = null
      else {
        const n = Number(trimmed)
        if (!Number.isInteger(n)) { error.value = 'Fødselsår må være et heltall'; saving.value = false; return }
        body.birthYear = n
      }
    }
    if (!Object.keys(body).length) { saving.value = false; return }

    const res = await authFetch(`/api/admin/person/${encodeURIComponent(props.slug)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as SaveResponse
    if (!res.ok) {
      error.value = out.error ?? `HTTP ${res.status}`
      return
    }
    emit('saved', out)
    snapshot()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

defineExpose({ draft, dirty })
</script>

<style scoped>
.edit-section {
  padding: var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}
.edit-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 var(--space-md);
}
.edit-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-md);
  align-items: center;
  margin-bottom: var(--space-sm);
}
.edit-label {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
}
.edit-input {
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
.edit-input:focus {
  outline: 1px solid var(--focus);
  outline-offset: 0;
  border-color: var(--focus);
}
.edit-input-narrow { max-width: 140px; }

.type-seg {
  display: inline-flex;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.type-seg-opt {
  display: inline-flex;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}
.type-seg-opt + .type-seg-opt { border-left: 1px solid var(--rule); }
.type-seg-opt input[type="radio"] {
  position: absolute;
  width: 1px; height: 1px;
  opacity: 0;
  pointer-events: none;
}
.type-seg-opt.active {
  background: var(--ink);
  color: var(--paper);
  font-weight: 500;
}

@media (max-width: 520px) {
  .edit-row { grid-template-columns: 1fr; gap: var(--space-xs); }
}

.edit-save-bar {
  margin-top: var(--space-md);
  padding: var(--space-md);
  background: var(--paper-sunken);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.edit-save-prompt {
  flex: 1;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink-soft);
  font-weight: 500;
}
.edit-btn-primary {
  padding: var(--space-sm) var(--space-lg);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  background: var(--faded-red);
  color: var(--paper);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.edit-btn-primary:hover:not(:disabled) { background: var(--faded-red-soft); }
.edit-btn-primary:disabled { background: var(--paper); color: var(--muted); cursor: not-allowed; }
.edit-link-revert {
  background: transparent;
  border: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  cursor: pointer;
}
.edit-link-revert:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }
.edit-link-revert:disabled { opacity: 0.5; cursor: not-allowed; }

.edit-save-error {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-sunken);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}
</style>
