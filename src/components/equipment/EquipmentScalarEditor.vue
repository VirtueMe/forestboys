<template>
  <section class="edit-section">
    <h3 class="edit-section-heading">{{ createMode ? 'Nytt utstyr' : 'Utstyr' }}</h3>

    <div class="edit-row">
      <label class="edit-label" for="edit-equipment-name">Navn</label>
      <input id="edit-equipment-name" v-model="draft.name" class="edit-input" type="text" />
    </div>

    <div v-if="createMode" class="edit-row">
      <label class="edit-label" for="edit-equipment-slug">Slug</label>
      <div class="slug-stack">
        <div class="slug-field">
          <input
            id="edit-equipment-slug"
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
        <span v-if="slugTaken" class="slug-hint">Slug finnes allerede for utstyr.</span>
      </div>
    </div>

    <div class="edit-row">
      <label class="edit-label" for="edit-equipment-type">Type</label>
      <select id="edit-equipment-type" v-model="draft.type" class="edit-input edit-input-short">
        <option value="">— ingen —</option>
        <option v-for="(label, key) in EQUIPMENT_TYPE_LABEL" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-equipment-subtype">Undertype</label>
      <input id="edit-equipment-subtype" v-model="draft.subtype" class="edit-input" type="text" placeholder="f.eks. agent-radio, ground-transponder" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-equipment-country">Land</label>
      <input id="edit-equipment-country" v-model="draft.country" class="edit-input edit-input-code" :class="{ 'code-invalid': !countryOk }" type="text" maxlength="2" placeholder="NO" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-equipment-period">Periode</label>
      <input id="edit-equipment-period" v-model="draft.period" class="edit-input edit-input-short" type="text" placeholder="f.eks. 1942–1945" />
    </div>
  </section>

  <footer v-if="createMode || dirty" class="edit-save-bar">
    <span class="edit-save-prompt">{{ createMode ? 'Opprett utstyr?' : 'Ser det bra ut?' }}</span>
    <button type="button" class="edit-btn-primary" :disabled="saving || !canSave" @click="save">
      {{ saving ? (createMode ? 'Oppretter…' : 'Lagrer…') : (createMode ? 'Opprett' : 'Lagre') }}
    </button>
    <button v-if="!createMode" type="button" class="edit-link-revert" :disabled="saving" @click="revert">Angre</button>
  </footer>
  <div v-if="error" class="edit-save-error">{{ error }}</div>
</template>

<script setup lang="ts">
/**
 * EquipmentScalarEditor — Utstyr edit/create form. Mirror of
 * LocationScalarEditor with EquipmentType fields: type (schema
 * vocabulary), subtype (free text), country (two-letter code), period.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { slugify, SLUG_RE } from '@/utils/slug.ts'
import { EQUIPMENT_TYPE_LABEL, type EquipmentNode } from '@/composables/useEquipmentData.ts'

export interface EquipmentDraft {
  name:    string
  type:    string
  subtype: string
  country: string
  period:  string
  /** Only consumed in createMode. */
  slug:    string
}

const props = defineProps<{
  slug:        string
  saved:       EquipmentNode
  createMode?: boolean
}>()

const emit = defineEmits<{
  saved:   [out: Partial<EquipmentNode>]
  created: [slug: string]
}>()

const empty: EquipmentDraft = { name: '', type: '', subtype: '', country: '', period: '', slug: '' }

const draft    = ref<EquipmentDraft>({ ...empty })
const baseline = ref<EquipmentDraft>({ ...empty })
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
        `MATCH (e:EquipmentType {slug: $slug}) RETURN e.slug AS slug LIMIT 1`,
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
  const snap: EquipmentDraft = {
    name:    props.saved.canonicalName ?? '',
    type:    props.saved.type ?? '',
    subtype: props.saved.subtype ?? '',
    country: props.saved.country ?? '',
    period:  props.saved.period ?? '',
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
  (Object.keys(draft.value) as (keyof EquipmentDraft)[]).some(k => draft.value[k] !== baseline.value[k]),
)

const countryOk = computed(() => {
  const c = draft.value.country.trim()
  return !c || /^[A-Za-z]{2}$/.test(c)
})

const canSave = computed(() => {
  if (!countryOk.value || !draft.value.name.trim()) return false
  if (!props.createMode) return dirty.value
  const s = draft.value.slug.trim()
  return SLUG_RE.test(s) && s !== 'new' && !slugTaken.value
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

/** Draft string → API value: trimmed, empty → null. */
const val = (s: string) => s.trim() || null

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value  = null
  const f = draft.value
  try {
    if (props.createMode) {
      const res = await authFetch(`/api/admin/equipment/new`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug:          f.slug.trim(),
          canonicalName: f.name.trim(),
          type:          val(f.type),
          subtype:       val(f.subtype),
          country:       val(f.country),
          period:        val(f.period),
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
    const b = baseline.value
    if (f.name    !== b.name)    body.canonicalName = f.name.trim()
    if (f.type    !== b.type)    body.type    = val(f.type)
    if (f.subtype !== b.subtype) body.subtype = val(f.subtype)
    if (f.country !== b.country) body.country = val(f.country)
    if (f.period  !== b.period)  body.period  = val(f.period)
    if (!Object.keys(body).length) return

    const res = await authFetch(`/api/admin/equipment/${encodeURIComponent(props.slug)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as Partial<EquipmentNode> & { error?: string }
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
  get draft(): EquipmentDraft { return draft.value },
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
.edit-input-short { max-width: 240px; }
.edit-input-code  { max-width: 72px; font-family: var(--font-mono); font-size: var(--size-mono); text-transform: uppercase; }
.edit-input.code-invalid { color: var(--danger); border-color: var(--danger); }

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
