<template>
  <section class="edit-section">
    <h3 class="edit-section-heading">Andre navn</h3>
    <p class="names-help">
      Tidligere eller senere navn, og andre navn stasjonen er kjent under. Navnet øverst er det som vises.
    </p>

    <p v-if="!draft.length" class="names-empty">Ingen andre navn</p>

    <ul v-else class="names-list">
      <li v-for="(row, i) in draft" :key="row.key" class="name-row">
        <div class="name-main">
          <input
            v-model="row.value"
            class="edit-input name-value"
            type="text"
            placeholder="f.eks. STS 47"
            :aria-label="`Navn ${i + 1}`"
          />
          <select v-model="row.type" class="edit-input name-type" :aria-label="`Type for navn ${i + 1}`">
            <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <button type="button" class="name-remove" :aria-label="`Fjern ${row.value || `navn ${i + 1}`}`" @click="remove(i)">✕</button>
        </div>

        <div class="name-period">
          <span class="period-end">
            <label class="period-label" :for="`name-from-${row.key}`">Fra</label>
            <input
              :id="`name-from-${row.key}`"
              v-model="row.from"
              class="edit-input edit-input-date"
              :class="{ invalid: dateInvalid(row.from) }"
              type="text"
              placeholder="ÅÅÅÅ-MM-DD"
            />
            <label class="about" :class="{ off: !row.from.trim() }">
              <input v-model="row.fromAbout" type="checkbox" :disabled="!row.from.trim()" />
              <span title="Omtrentlig dato">ca.</span>
            </label>
          </span>
          <span class="period-end">
            <label class="period-label" :for="`name-to-${row.key}`">Til</label>
            <input
              :id="`name-to-${row.key}`"
              v-model="row.to"
              class="edit-input edit-input-date"
              :class="{ invalid: dateInvalid(row.to) }"
              type="text"
              placeholder="ÅÅÅÅ-MM-DD"
            />
            <label class="about" :class="{ off: !row.to.trim() }">
              <input v-model="row.toAbout" type="checkbox" :disabled="!row.to.trim()" />
              <span title="Omtrentlig dato">ca.</span>
            </label>
          </span>
          <button type="button" class="refs-toggle" :aria-expanded="row.refsOpen" @click="row.refsOpen = !row.refsOpen">
            Kilder{{ row.sourceRefs.length ? ` (${row.sourceRefs.length})` : '' }}
          </button>
        </div>

        <p v-if="rowError(row)" class="name-error">{{ rowError(row) }}</p>

        <div v-if="row.refsOpen" class="name-refs">
          <SourceRefsEditor v-model="row.sourceRefs" />
        </div>
      </li>
    </ul>

    <button type="button" class="names-add" @click="add">+ Legg til navn</button>
  </section>

  <footer v-if="dirty" class="edit-save-bar">
    <span class="edit-save-prompt">Ser det bra ut?</span>
    <button type="button" class="edit-btn-primary" :disabled="saving || !canSave" @click="save">
      {{ saving ? 'Lagrer…' : 'Lagre' }}
    </button>
    <button type="button" class="edit-link-revert" :disabled="saving" @click="revert">Angre</button>
  </footer>
  <div v-if="error" class="edit-save-error">{{ error }}</div>
</template>

<script setup lang="ts">
/**
 * StationNamesEditor — the Station's other names (HAS_NAME → Name): former
 * and later names and aliases, each with an optional period (either end can
 * be "ca.") and sources. Saves the whole list at once to
 * PATCH /api/admin/station/:slug/names (functions/_lib/names.ts has the rules).
 * The names are not in the create form: the Station has to exist first.
 */
import { ref, computed, watch } from 'vue'
import SourceRefsEditor from '@/components/SourceRefsEditor.vue'
import { authFetch } from '@/composables/useAuth.ts'
import type { StationName, StationNameType } from '@/composables/useStationData.ts'

const props = defineProps<{
  slug:  string
  saved: StationName[]
}>()

const emit = defineEmits<{
  saved: [names: StationName[]]
}>()

const TYPES: { value: StationNameType; label: string }[] = [
  { value: 'former', label: 'Tidligere navn' },
  { value: 'later',  label: 'Senere navn' },
  { value: 'alias',  label: 'Annet navn' },
]

const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/

interface Row {
  /** Local list key — the id is only known after the first save. */
  key:        string
  id:         string | null
  value:      string
  type:       StationNameType
  from:       string
  fromAbout:  boolean
  to:         string
  toAbout:    boolean
  sourceRefs: string[]
  refsOpen:   boolean
}

const draft    = ref<Row[]>([])
const baseline = ref('')
const saving   = ref(false)
const error    = ref<string | null>(null)

let nextKey = 0
const newKey = () => `n${nextKey++}`

/** What counts as a change: everything but the local key and the open/closed state. */
function signature(rows: Row[]): string {
  return JSON.stringify(rows.map(r => [
    r.id, r.value.trim(), r.type, r.from.trim(), r.from.trim() ? r.fromAbout : false,
    r.to.trim(), r.to.trim() ? r.toAbout : false, r.sourceRefs,
  ]))
}

function snapshot() {
  draft.value = props.saved.map(n => ({
    key:        newKey(),
    id:         n.id,
    value:      n.value,
    type:       n.type,
    from:       n.from ?? '',
    fromAbout:  n.fromAbout,
    to:         n.to ?? '',
    toAbout:    n.toAbout,
    sourceRefs: [...n.sourceRefs],
    refsOpen:   false,
  }))
  baseline.value = signature(draft.value)
  error.value    = null
}
watch(() => props.saved, snapshot, { immediate: true })

const dirty = computed(() => signature(draft.value) !== baseline.value)

function dateInvalid(v: string): boolean {
  const t = v.trim()
  return t !== '' && !DATE_RE.test(t)
}

function rowError(r: Row): string | null {
  if (!r.value.trim()) return 'Navnet kan ikke være tomt'
  if (dateInvalid(r.from) || dateInvalid(r.to)) return 'Bruk ÅÅÅÅ, ÅÅÅÅ-MM eller ÅÅÅÅ-MM-DD'
  const f = r.from.trim(), t = r.to.trim()
  if (f && t) {
    const n = Math.min(f.length, t.length)
    if (t.slice(0, n) < f.slice(0, n)) return 'Sluttdatoen er før startdatoen'
  }
  const dup = draft.value.some(o => o !== r && o.type === r.type && o.value.trim().toLowerCase() === r.value.trim().toLowerCase())
  if (dup && r.value.trim()) return 'Navnet er oppgitt to ganger'
  return null
}

const canSave = computed(() => dirty.value && draft.value.every(r => rowError(r) === null))

function add() {
  draft.value.push({
    key: newKey(), id: null, value: '', type: 'former',
    from: '', fromAbout: false, to: '', toAbout: false, sourceRefs: [], refsOpen: false,
  })
}

function remove(i: number) {
  draft.value.splice(i, 1)
}

function revert() {
  snapshot()
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value  = null
  try {
    const rows = draft.value
    const res = await authFetch(`/api/admin/station/${encodeURIComponent(props.slug)}/names`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        names: rows.map(r => ({
          id:         r.id,
          value:      r.value.trim(),
          type:       r.type,
          from:       r.from.trim() || null,
          fromAbout:  r.from.trim() ? r.fromAbout : false,
          to:         r.to.trim() || null,
          toAbout:    r.to.trim() ? r.toAbout : false,
          sourceRefs: r.sourceRefs,
        })),
      }),
    })
    const out = await res.json().catch(() => ({})) as { ids?: string[]; error?: string }
    if (!res.ok || !out.ids) {
      error.value = out.error ?? `HTTP ${res.status}`
      return
    }
    const ids = out.ids
    emit('saved', rows.map((r, i) => ({
      id:         ids[i],
      value:      r.value.trim(),
      type:       r.type,
      from:       r.from.trim() || null,
      fromAbout:  r.from.trim() ? r.fromAbout : false,
      to:         r.to.trim() || null,
      toAbout:    r.to.trim() ? r.toAbout : false,
      sourceRefs: [...r.sourceRefs],
    })))
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

defineExpose({
  get dirty(): boolean { return dirty.value },
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
  margin: 0 0 var(--space-xs);
}
.names-help {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  margin: 0 0 var(--space-md);
}
.names-empty {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--muted);
  margin: 0 0 var(--space-sm);
}
.names-list { list-style: none; margin: 0 0 var(--space-sm); padding: 0; }
.name-row {
  padding: var(--space-sm) 0;
  border-bottom: 1px solid var(--rule);
}
.name-row:last-child { border-bottom: none; }

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
.edit-input:focus { outline: 1px solid var(--focus); outline-offset: 0; border-color: var(--focus); }
.edit-input.invalid { border-color: var(--danger); color: var(--danger); }
.edit-input-date { font-family: var(--font-mono); font-size: var(--size-mono); width: 9.5em; }

.name-main { display: flex; gap: var(--space-sm); align-items: center; }
.name-main .name-value { flex: 1 1 0; min-width: 0; width: auto; }
.name-main .name-type  { flex: 0 0 auto; width: auto; }

.name-remove {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--rule);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.name-remove:hover { border-color: var(--danger); color: var(--danger); }

.name-period {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm) var(--space-md);
  align-items: center;
  margin-top: var(--space-sm);
}
.period-end { display: inline-flex; align-items: center; gap: var(--space-xs); }
.period-label {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
}
.about {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
  cursor: pointer;
}
.about.off { opacity: 0.45; cursor: not-allowed; }

.refs-toggle {
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
.refs-toggle:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

.name-error {
  margin: var(--space-xs) 0 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}
.name-refs { margin-top: var(--space-sm); }

.names-add {
  background: transparent;
  border: 1px dashed var(--rule);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink-soft);
  cursor: pointer;
}
.names-add:hover { border-color: var(--faded-red); color: var(--faded-red); }

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
.edit-save-prompt { flex: 1; font-family: var(--font-sans); font-size: var(--size-body-ui); color: var(--ink-soft); font-weight: 500; }
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

@media (max-width: 520px) {
  .name-main { flex-wrap: wrap; }
  .name-main .name-value { flex-basis: 100%; }
  .name-main .name-type  { flex: 1 1 0; }
}
</style>
