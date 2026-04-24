<template>
  <section class="edit-section">
    <div class="edit-section-head">
      <h3 class="edit-section-heading">Grad</h3>
      <button type="button" class="edit-btn-outline" @click="addRank">+ Legg til grad</button>
    </div>
    <div v-if="!draft.length" class="edit-empty">Ingen grad</div>
    <div v-for="(r, i) in draft" :key="i" class="rank-edit-row">
      <select
        :value="r.rankSlug"
        class="edit-input rank-edit-select"
        @change="setRankSlug(i, ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="opt in options" :key="opt.slug" :value="opt.slug">{{ opt.name }}</option>
      </select>
      <input
        class="edit-input edit-input-year"
        type="text"
        inputmode="numeric"
        placeholder="fra"
        :value="yearModel(i, 'from')"
        @input="setYear(i, 'from', ($event.target as HTMLInputElement).value)"
      />
      <span class="rank-dash">–</span>
      <input
        class="edit-input edit-input-year"
        type="text"
        inputmode="numeric"
        placeholder="til"
        :value="yearModel(i, 'to')"
        @input="setYear(i, 'to', ($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="rank-remove-btn" aria-label="Fjern" @click="removeRank(i)">✕</button>
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
 * PersonRanksEditor — admin editor for the Person's HELD_RANK edges.
 * Owns its own draft + save logic; emits `saved` with the updated array
 * so the parent can refresh `heldRanks`.
 *
 * Save endpoint: PATCH /api/admin/person/:slug/ranks.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import type { HeldRank, RankOption } from './types.ts'

const props = defineProps<{
  slug:    string
  saved:   HeldRank[]
  options: RankOption[]
}>()

const emit = defineEmits<{ saved: [ranks: HeldRank[]] }>()

const draft    = ref<HeldRank[]>([])
const baseline = ref<HeldRank[]>([])
const saving   = ref(false)
const error    = ref<string | null>(null)

function snapshot() {
  draft.value    = props.saved.map(r => ({ ...r }))
  baseline.value = props.saved.map(r => ({ ...r }))
  error.value    = null
}
watch(() => props.saved, snapshot, { deep: true, immediate: true })

function sigOf(arr: HeldRank[]): string {
  return JSON.stringify(arr.map(r => [r.rankSlug, r.from, r.to]))
}
const dirty = computed(() => sigOf(draft.value) !== sigOf(baseline.value))

function addRank() {
  const first = props.options[0]
  draft.value.push({
    rankSlug: first?.slug ?? '',
    rankName: first?.name ?? '',
    tier:     first?.tier ?? null,
    from:     null,
    to:       null,
  })
}
function removeRank(i: number) { draft.value.splice(i, 1) }

function setRankSlug(i: number, slug: string) {
  const option = props.options.find(o => o.slug === slug)
  if (!option) return
  const row = draft.value[i]
  if (!row) return
  row.rankSlug = option.slug
  row.rankName = option.name
  row.tier     = option.tier
}

function yearModel(i: number, key: 'from' | 'to'): string {
  return draft.value[i]?.[key] != null ? String(draft.value[i]?.[key]) : ''
}
function setYear(i: number, key: 'from' | 'to', value: string) {
  const row = draft.value[i]
  if (!row) return
  const trimmed = value.trim()
  if (!trimmed) { row[key] = null; return }
  const n = Number(trimmed)
  if (Number.isInteger(n)) row[key] = n
}

function revert() {
  draft.value = baseline.value.map(r => ({ ...r }))
  error.value = null
}

async function save() {
  saving.value = true
  error.value  = null
  try {
    const payload = { ranks: draft.value.map(r => ({ rankSlug: r.rankSlug, from: r.from, to: r.to })) }
    const res = await authFetch(`/api/admin/person/${encodeURIComponent(props.slug)}/ranks`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    const updated = draft.value.map(r => ({ ...r }))
    baseline.value = updated
    emit('saved', updated)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.edit-section {
  padding: var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}
.edit-section + .edit-section { margin-top: var(--space-lg); }

.edit-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}
.edit-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin: 0;
}

.edit-btn-outline {
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.edit-btn-outline:hover { background: var(--paper-sunken); }

.edit-empty {
  padding: var(--space-md);
  text-align: center;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-style: italic;
  color: var(--muted);
  border: 1px dashed var(--rule);
  border-radius: var(--radius-md);
}

.rank-edit-row {
  display: grid;
  grid-template-columns: 1fr 90px auto 90px auto;
  gap: var(--space-sm);
  align-items: center;
  margin-bottom: var(--space-sm);
}
.rank-edit-select { min-width: 0; }

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
.edit-input-year { font-family: var(--font-mono); font-size: var(--size-mono); }
.rank-dash { text-align: center; color: var(--muted); }

.rank-remove-btn {
  height: 32px;
  padding: 0 var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--danger);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  cursor: pointer;
  white-space: nowrap;
}
.rank-remove-btn:hover { background: var(--paper-sunken); border-color: var(--danger); }

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
