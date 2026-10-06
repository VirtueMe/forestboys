<template>
  <section class="edit-section">
    <h2 class="edit-section-heading">{{ createMode ? 'Nytt fremkomstmiddel' : 'Fremkomstmiddel' }}</h2>

    <div class="edit-row">
      <label class="edit-label" for="edit-transport-name">Navn</label>
      <input id="edit-transport-name" v-model="draft.name" class="edit-input" type="text" />
    </div>

    <div v-if="createMode" class="edit-row">
      <label class="edit-label" for="edit-transport-slug">Slug</label>
      <div class="slug-stack">
        <div class="slug-field">
          <input
            id="edit-transport-slug"
            v-model="draft.slug"
            class="edit-input"
            :class="{ locked: !slugEditable, [`slug-${slugState}`]: true }"
            :readonly="!slugEditable"
            type="text"
            placeholder="kebab-case"
          />
          <button
            type="button"
            class="slug-toggle"
            :aria-label="slugEditable ? 'Lås slug' : 'Rediger slug'"
            @click="toggleSlugEdit"
          >
            {{ slugEditable ? '✓' : '✎' }}
          </button>
        </div>
        <span v-if="slugTaken" class="slug-hint">Slug finnes allerede for et fremkomstmiddel.</span>
      </div>
    </div>

    <div class="edit-row">
      <label class="edit-label" for="edit-transport-type">Type</label>
      <input id="edit-transport-type" v-model="draft.type" class="edit-input" type="text" placeholder="f.eks. Bomber, MTB, fartøy" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-transport-unit">Enhet</label>
      <input id="edit-transport-unit" v-model="draft.unit" class="edit-input" type="text" placeholder="f.eks. RAF 196, Shetlands-gjengen" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-transport-regser">Registrering</label>
      <input id="edit-transport-regser" v-model="draft.regser" class="edit-input edit-input-mono" type="text" placeholder="f.eks. LJ935 QS-P" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-transport-reserve">Reserve</label>
      <input id="edit-transport-reserve" v-model="draft.reserve" class="edit-input" type="text" />
    </div>
  </section>

  <footer v-if="createMode || dirty" class="edit-save-bar">
    <span class="edit-save-prompt">{{ createMode ? 'Opprett fremkomstmiddel?' : 'Ser det bra ut?' }}</span>
    <button type="button" class="edit-btn-primary" :disabled="saving || !canSave" @click="save">
      {{ saving ? (createMode ? 'Oppretter…' : 'Lagrer…') : (createMode ? 'Opprett' : 'Lagre') }}
    </button>
    <button v-if="!createMode" type="button" class="edit-link-revert" :disabled="saving" @click="revert">Angre</button>
  </footer>
  <div v-if="error" class="edit-save-error">{{ error }}</div>
</template>

<script setup lang="ts">
/**
 * TransportScalarEditor — edit/create form for a Transport (vehicle/
 * aircraft) node. Mirror of StationScalarEditor with the Transport
 * field set: name, type, unit, regser (registration/serial), reserve.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { slugify, SLUG_RE } from '@/utils/slug.ts'
import type { TransportNode } from '@/composables/useTransportData.ts'

export interface TransportDraft {
  name:    string
  type:    string
  unit:    string
  regser:  string
  reserve: string
  /** Only consumed in createMode. */
  slug:    string
}

const props = defineProps<{
  slug:        string
  saved:       TransportNode
  createMode?: boolean
}>()

const emit = defineEmits<{
  saved:   [out: Partial<TransportNode>]
  created: [slug: string]
}>()

const empty: TransportDraft = {
  name: '', type: '', unit: '', regser: '', reserve: '', slug: '',
}

const draft    = ref<TransportDraft>({ ...empty })
const baseline = ref<TransportDraft>({ ...empty })
const saving   = ref(false)
const error    = ref<string | null>(null)

const slugEdited   = ref(false)
const slugEditable = ref(true)
const slugTaken    = ref(false)
const slugChecking = ref(false)
let slugCheckTimer: ReturnType<typeof setTimeout> | null = null
watch(() => draft.value.slug, (s) => {
  if (!props.createMode) return
  slugTaken.value    = false
  slugChecking.value = false
  if (slugCheckTimer) clearTimeout(slugCheckTimer)
  if (!SLUG_RE.test(s) || s === 'new') return
  slugChecking.value = true
  slugCheckTimer = setTimeout(async () => {
    try {
      const rows = await neo4jQuery<{ slug: string }>(
        `MATCH (t:Transport {slug: $slug}) RETURN t.slug AS slug LIMIT 1`,
        { slug: s },
      )
      if (draft.value.slug === s) slugTaken.value = rows.length > 0
    } catch { /* silent */ }
    finally {
      if (draft.value.slug === s) slugChecking.value = false
    }
  }, 250)
})

const slugState = computed<'neutral' | 'invalid' | 'valid'>(() => {
  if (!props.createMode) return 'neutral'
  const s = draft.value.slug.trim()
  if (!s || s === 'new') return 'neutral'
  if (!SLUG_RE.test(s)) return 'invalid'
  if (slugChecking.value) return 'neutral'
  if (slugTaken.value)    return 'invalid'
  return 'valid'
})

function snapshot() {
  const snap: TransportDraft = {
    name:    props.saved.name ?? '',
    type:    props.saved.type ?? '',
    unit:    props.saved.unit ?? '',
    regser:  props.saved.regser ?? '',
    reserve: props.saved.reserve ?? '',
    slug:    props.createMode ? 'new' : '',
  }
  draft.value    = { ...snap }
  baseline.value = { ...snap }
  error.value    = null
  slugEdited.value   = false
  slugEditable.value = false
}
watch(() => props.saved, snapshot, { immediate: true, deep: true })

watch(() => draft.value.name, (v) => {
  if (!props.createMode) return
  if (slugEdited.value) return
  draft.value.slug = slugify(v)
})

const dirty = computed(() =>
  (Object.keys(draft.value) as (keyof TransportDraft)[]).some(k => draft.value[k] !== baseline.value[k]),
)

const canSave = computed(() => {
  if (!props.createMode) return dirty.value
  const s = draft.value.slug.trim()
  return draft.value.name.trim().length > 0 && SLUG_RE.test(s) && s !== 'new' && !slugTaken.value
})

function toggleSlugEdit() {
  if (!slugEditable.value) {
    slugEditable.value = true
    slugEdited.value = true
  } else {
    draft.value.slug = slugify(draft.value.slug)
    slugEditable.value = false
  }
}

function revert() {
  draft.value = { ...baseline.value }
  error.value = null
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value  = null
  try {
    if (props.createMode) {
      const f = draft.value
      const res = await authFetch(`/api/admin/transport/new`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug:          f.slug.trim(),
          canonicalName: f.name.trim(),
          type:          f.type.trim() || null,
        }),
      })
      const out = await res.json().catch(() => ({})) as { slug?: string; error?: string }
      if (!res.ok) {
        error.value = out.error ?? `HTTP ${res.status}`
        if (res.status === 409) slugEditable.value = true
        return
      }
      emit('created', out.slug ?? f.slug.trim())
      return
    }

    const body: Record<string, unknown> = {}
    const f = draft.value, b = baseline.value
    if (f.name    !== b.name)    body.name    = f.name.trim()
    if (f.type    !== b.type)    body.type    = f.type.trim()    || null
    if (f.unit    !== b.unit)    body.unit    = f.unit.trim()    || null
    if (f.regser  !== b.regser)  body.regser  = f.regser.trim()  || null
    if (f.reserve !== b.reserve) body.reserve = f.reserve.trim() || null
    if (!Object.keys(body).length) { saving.value = false; return }

    const res = await authFetch(`/api/admin/transport/${encodeURIComponent(props.slug)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as Partial<TransportNode> & { error?: string }
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
  get draft(): TransportDraft { return draft.value },
  get dirty(): boolean        { return dirty.value },
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
.edit-input:focus { outline: 1px solid var(--focus); outline-offset: 0; border-color: var(--focus); }
.edit-input.locked { background: var(--paper-sunken); color: var(--muted); font-family: var(--font-mono); font-size: var(--size-mono); }
.edit-input-mono { font-family: var(--font-mono); font-size: var(--size-mono); }

.slug-stack { display: flex; flex-direction: column; gap: var(--space-xs); }
.slug-field { display: flex; gap: var(--space-xs); }
.slug-hint { font-family: var(--font-sans); font-size: var(--size-label); color: var(--danger); }
.edit-input.slug-valid   { color: var(--moss);   border-color: var(--moss); }
.edit-input.slug-invalid { color: var(--danger); border-color: var(--danger); }
.slug-toggle {
  flex-shrink: 0;
  width: 36px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  font-size: var(--size-body-ui);
  color: var(--ink-soft);
  cursor: pointer;
  transition: background 120ms ease-out, color 120ms ease-out;
}
.slug-toggle:hover { background: var(--paper-sunken); color: var(--faded-red); }

@media (max-width: 520px) { .edit-row { grid-template-columns: 1fr; gap: var(--space-xs); } }

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
</style>
