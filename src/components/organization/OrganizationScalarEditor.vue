<template>
  <section class="edit-section">
    <h3 class="edit-section-heading">Organisasjon</h3>
    <div class="edit-row">
      <label class="edit-label" for="edit-name">Navn</label>
      <input id="edit-name" v-model="draft.name" class="edit-input" type="text" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-formalName">Formelt navn</label>
      <input id="edit-formalName" v-model="draft.formalName" class="edit-input" type="text" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-abbreviation">Forkortelse</label>
      <input id="edit-abbreviation" v-model="draft.abbreviation" class="edit-input" type="text" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-sortingName">Sorteringsnavn</label>
      <input id="edit-sortingName" v-model="draft.sortingName" class="edit-input" type="text" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-color">Farge</label>
      <div class="edit-color-row">
        <input
          id="edit-color"
          v-model="draft.color"
          class="edit-input edit-input-color-text"
          type="text"
          placeholder="#aabbcc"
        />
        <span v-if="draft.color" class="edit-color-swatch" :style="{ background: draft.color }"></span>
      </div>
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-country">Land</label>
      <input id="edit-country" v-model="draft.country" class="edit-input" type="text" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-foundedDate">Etablert</label>
      <input
        id="edit-foundedDate"
        v-model="draft.foundedDate"
        class="edit-input edit-input-date"
        type="text"
        placeholder="YYYY-MM-DD"
      />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-dissolvedDate">Oppløst</label>
      <input
        id="edit-dissolvedDate"
        v-model="draft.dissolvedDate"
        class="edit-input edit-input-date"
        type="text"
        placeholder="YYYY-MM-DD"
      />
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
 * OrganizationScalarEditor — Organisasjon edit form (8 scalar fields).
 * Owns its own draft + save logic. Emits `saved` with the server's
 * response so the parent can update its `org` ref.
 *
 * Draft + dirty flag are exposed via defineExpose so the page header's
 * preview overlay sees the unsaved values live.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import type { OrgNode } from '@/composables/useOrganizationData.ts'

export interface OrgDraft {
  name:          string
  formalName:    string
  abbreviation:  string
  sortingName:   string
  color:         string
  country:       string
  foundedDate:   string
  dissolvedDate: string
}

const props = defineProps<{
  slug:  string
  saved: OrgNode
}>()

const emit = defineEmits<{ saved: [out: Partial<OrgNode>] }>()

const empty: OrgDraft = {
  name: '', formalName: '', abbreviation: '', sortingName: '',
  color: '', country: '', foundedDate: '', dissolvedDate: '',
}

const draft    = ref<OrgDraft>({ ...empty })
const baseline = ref<OrgDraft>({ ...empty })
const saving   = ref(false)
const error    = ref<string | null>(null)

function snapshot() {
  const snap: OrgDraft = {
    name:          props.saved.name ?? '',
    formalName:    props.saved.formalName ?? '',
    abbreviation:  props.saved.abbreviation ?? '',
    sortingName:   props.saved.sortingName ?? '',
    color:         props.saved.color ?? '',
    country:       props.saved.country ?? '',
    foundedDate:   props.saved.foundedDate ?? '',
    dissolvedDate: props.saved.dissolvedDate ?? '',
  }
  draft.value    = { ...snap }
  baseline.value = { ...snap }
  error.value    = null
}
watch(() => props.saved, snapshot, { immediate: true, deep: true })

const dirty = computed(() =>
  (Object.keys(draft.value) as (keyof OrgDraft)[]).some(k => draft.value[k] !== baseline.value[k]),
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
    if (f.name          !== b.name)          body.name          = f.name.trim()
    if (f.formalName    !== b.formalName)    body.formalName    = f.formalName.trim()    || null
    if (f.abbreviation  !== b.abbreviation)  body.abbreviation  = f.abbreviation.trim()  || null
    if (f.sortingName   !== b.sortingName)   body.sortingName   = f.sortingName.trim()   || null
    if (f.color         !== b.color)         body.color         = f.color.trim()         || null
    if (f.country       !== b.country)       body.country       = f.country.trim()       || null
    if (f.foundedDate   !== b.foundedDate)   body.foundedDate   = f.foundedDate.trim()   || null
    if (f.dissolvedDate !== b.dissolvedDate) body.dissolvedDate = f.dissolvedDate.trim() || null
    if (!Object.keys(body).length) { saving.value = false; return }

    const res = await authFetch(`/api/admin/organization/${encodeURIComponent(props.slug)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as Partial<OrgNode> & { error?: string }
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

defineExpose({
  get draft(): OrgDraft { return draft.value },
  get dirty(): boolean  { return dirty.value },
})
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
.edit-input-date { font-family: var(--font-mono); font-size: var(--size-mono); max-width: 160px; }

.edit-color-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.edit-input-color-text {
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  max-width: 140px;
}
.edit-color-swatch {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-md);
  border: 1px solid var(--rule);
  flex-shrink: 0;
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
