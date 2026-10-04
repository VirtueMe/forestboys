<template>
  <section class="edit-section">
    <h3 class="edit-section-heading">{{ createMode ? 'Ny stasjon' : 'Stasjon' }}</h3>

    <div class="edit-row">
      <label class="edit-label" for="edit-station-name">Navn</label>
      <input id="edit-station-name" v-model="draft.name" class="edit-input" type="text" />
    </div>

    <div v-if="createMode" class="edit-row">
      <label class="edit-label" for="edit-station-slug">Slug</label>
      <div class="slug-stack">
        <div class="slug-field">
          <input
            id="edit-station-slug"
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
        <span v-if="slugTaken" class="slug-hint">Slug finnes allerede for en stasjon.</span>
      </div>
    </div>

    <div class="edit-row">
      <label class="edit-label" for="edit-station-category">Kategori</label>
      <div class="category-stack">
        <select id="edit-station-category" v-model="draft.category" class="edit-input edit-input-select">
          <option value="">Ikke satt</option>
          <option v-for="c in STATION_CATEGORIES" :key="c" :value="c">{{ STATION_CATEGORY_LABEL[c] }}</option>
        </select>
        <span v-if="suggestion" class="category-hint">
          Forslag ut fra «{{ draft.type.trim() }}»: {{ STATION_CATEGORY_LABEL[suggestion] }}
          <button type="button" class="category-use" @click="draft.category = suggestion">Bruk</button>
        </span>
      </div>
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-station-type">Funksjon</label>
      <input id="edit-station-type" v-model="draft.type" class="edit-input" type="text" placeholder="f.eks. flyplass, radiostasjon, forskning og utvikling" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-station-lat">Breddegrad</label>
      <input id="edit-station-lat" v-model="draft.lat" class="edit-input edit-input-coord" type="text" inputmode="decimal" placeholder="59.913" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-station-lng">Lengdegrad</label>
      <input id="edit-station-lng" v-model="draft.lng" class="edit-input edit-input-coord" type="text" inputmode="decimal" placeholder="10.752" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-station-activeFrom">Aktiv fra</label>
      <input id="edit-station-activeFrom" v-model="draft.activeFrom" class="edit-input edit-input-date" type="text" placeholder="YYYY-MM-DD" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-station-activeTo">Aktiv til</label>
      <input id="edit-station-activeTo" v-model="draft.activeTo" class="edit-input edit-input-date" type="text" placeholder="YYYY-MM-DD" />
    </div>
  </section>

  <footer v-if="createMode || dirty" class="edit-save-bar">
    <span class="edit-save-prompt">{{ createMode ? 'Opprett stasjon?' : 'Ser det bra ut?' }}</span>
    <button type="button" class="edit-btn-primary" :disabled="saving || !canSave" @click="save">
      {{ saving ? (createMode ? 'Oppretter…' : 'Lagrer…') : (createMode ? 'Opprett' : 'Lagre') }}
    </button>
    <button v-if="!createMode" type="button" class="edit-link-revert" :disabled="saving" @click="revert">Angre</button>
  </footer>
  <div v-if="error" class="edit-save-error">{{ error }}</div>
</template>

<script setup lang="ts">
/**
 * StationScalarEditor — Stasjon edit/create form (name, Kategori, Funksjon,
 * coordinates, active period). Mirror of
 * UnitScalarEditor with Station-specific fields (type + coordinates +
 * active period). Coordinates are typed as strings in the draft so the
 * user can leave them empty without typing 0; parsed at save time.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { slugify, SLUG_RE } from '@/utils/slug.ts'
import type { StationNode } from '@/composables/useStationData.ts'
import {
  STATION_CATEGORIES, STATION_CATEGORY_LABEL, suggestStationCategory, type StationCategory,
} from '@/utils/stationCategory.ts'

export interface StationDraft {
  name:       string
  type:       string
  /** '' = not set. */
  category:   '' | StationCategory
  lat:        string
  lng:        string
  activeFrom: string
  activeTo:   string
  /** Only consumed in createMode. */
  slug:       string
}

const props = defineProps<{
  slug:        string
  saved:       StationNode
  createMode?: boolean
}>()

const emit = defineEmits<{
  saved:   [out: Partial<StationNode>]
  created: [slug: string]
}>()

const empty: StationDraft = {
  name: '', type: '', category: '', lat: '', lng: '', activeFrom: '', activeTo: '', slug: '',
}

const draft    = ref<StationDraft>({ ...empty })
const baseline = ref<StationDraft>({ ...empty })
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
        `MATCH (s:Station {slug: $slug}) RETURN s.slug AS slug LIMIT 1`,
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
  const snap: StationDraft = {
    name:       props.saved.name ?? '',
    type:       props.saved.type ?? '',
    category:   props.saved.category ?? '',
    lat:        props.saved.lat == null ? '' : String(props.saved.lat),
    lng:        props.saved.lng == null ? '' : String(props.saved.lng),
    activeFrom: props.saved.activeFrom ?? '',
    activeTo:   props.saved.activeTo ?? '',
    slug:       props.createMode ? 'new' : '',
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

/** A guess from the free-text function — only offered while the category is not set. */
const suggestion = computed<StationCategory | null>(() =>
  draft.value.category ? null : suggestStationCategory(draft.value.type),
)

const dirty = computed(() =>
  (Object.keys(draft.value) as (keyof StationDraft)[]).some(k => draft.value[k] !== baseline.value[k]),
)

/** Returns the parsed value, or 'invalid' if non-empty and unparseable. */
function parseCoord(v: string): number | null | 'invalid' {
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : 'invalid'
}

const canSave = computed(() => {
  const lat = parseCoord(draft.value.lat)
  const lng = parseCoord(draft.value.lng)
  if (lat === 'invalid' || lng === 'invalid') return false
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
    const lat = parseCoord(draft.value.lat)
    const lng = parseCoord(draft.value.lng)
    if (lat === 'invalid' || lng === 'invalid') {
      error.value = 'Koordinater må være tall'
      saving.value = false
      return
    }

    if (props.createMode) {
      const f = draft.value
      const res = await authFetch(`/api/admin/station/new`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug:          f.slug.trim(),
          canonicalName: f.name.trim(),
          type:          f.type.trim() || null,
          category:      f.category || null,
          lat, lng,
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
    if (f.name       !== b.name)       body.name       = f.name.trim()
    if (f.type       !== b.type)       body.type       = f.type.trim() || null
    if (f.category   !== b.category)   body.category   = f.category || null
    if (f.lat        !== b.lat)        body.lat        = lat
    if (f.lng        !== b.lng)        body.lng        = lng
    if (f.activeFrom !== b.activeFrom) body.activeFrom = f.activeFrom.trim() || null
    if (f.activeTo   !== b.activeTo)   body.activeTo   = f.activeTo.trim()   || null
    if (!Object.keys(body).length) { saving.value = false; return }

    const res = await authFetch(`/api/admin/station/${encodeURIComponent(props.slug)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as Partial<StationNode> & { error?: string }
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
  get draft(): StationDraft { return draft.value },
  get dirty(): boolean      { return dirty.value },
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
.edit-input-select { width: auto; min-width: 10em; }
.category-stack { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs) var(--space-md); }
.category-hint { font-family: var(--font-sans); font-size: var(--size-label); color: var(--ink-soft); }
.category-use {
  margin-left: var(--space-xs);
  background: transparent;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  cursor: pointer;
}
.category-use:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }
.edit-input-coord { font-family: var(--font-mono); font-size: var(--size-mono); max-width: 160px; }
.edit-input-date  { font-family: var(--font-mono); font-size: var(--size-mono); max-width: 160px; }

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
