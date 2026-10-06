<template>
  <section class="edit-section">
    <h2 class="edit-section-heading">{{ createMode ? 'Nytt sted' : 'Sted' }}</h2>

    <div class="edit-row">
      <label class="edit-label" for="edit-location-name">Navn</label>
      <input id="edit-location-name" v-model="draft.name" class="edit-input" type="text" />
    </div>

    <div v-if="createMode" class="edit-row">
      <label class="edit-label" for="edit-location-slug">Slug</label>
      <div class="slug-stack">
        <div class="slug-field">
          <input
            id="edit-location-slug"
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
        <span v-if="slugTaken" class="slug-hint">Slug finnes allerede for et sted.</span>
      </div>
    </div>

    <div class="edit-row">
      <label class="edit-label" for="edit-location-lat">Breddegrad</label>
      <input id="edit-location-lat" v-model="draft.lat" class="edit-input edit-input-coord" type="text" inputmode="decimal" placeholder="59.913" />
    </div>
    <div class="edit-row">
      <label class="edit-label" for="edit-location-lng">Lengdegrad</label>
      <input id="edit-location-lng" v-model="draft.lng" class="edit-input edit-input-coord" type="text" inputmode="decimal" placeholder="10.752" />
    </div>
    <div class="edit-row edit-row-map">
      <span class="edit-label">Kart</span>
      <LocationMap :lat="pickerLat" :lng="pickerLng" @pick="onPick" />
    </div>
  </section>

  <footer v-if="createMode || dirty" class="edit-save-bar">
    <span class="edit-save-prompt">{{ createMode ? 'Opprett sted?' : 'Ser det bra ut?' }}</span>
    <button type="button" class="edit-btn-primary" :disabled="saving || !canSave" @click="save">
      {{ saving ? (createMode ? 'Oppretter…' : 'Lagrer…') : (createMode ? 'Opprett' : 'Lagre') }}
    </button>
    <button v-if="!createMode" type="button" class="edit-link-revert" :disabled="saving" @click="revert">Angre</button>
  </footer>
  <div v-if="error" class="edit-save-error">{{ error }}</div>
</template>

<script setup lang="ts">
/**
 * LocationScalarEditor — Sted edit/create form. Mirror of
 * StationScalarEditor, trimmed to name + coordinates. Coordinates are
 * typed as strings in the draft so the user can leave them empty
 * without typing 0; parsed at save time. The map picker writes back
 * into the same string fields.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { slugify, SLUG_RE } from '@/utils/slug.ts'
import type { LocationNode } from '@/composables/useLocationData.ts'
import LocationMap from './LocationMap.vue'

export interface LocationDraft {
  name: string
  lat:  string
  lng:  string
  /** Only consumed in createMode. */
  slug: string
}

const props = defineProps<{
  slug:        string
  saved:       LocationNode
  createMode?: boolean
}>()

const emit = defineEmits<{
  saved:   [out: Partial<LocationNode>]
  created: [slug: string]
}>()

const empty: LocationDraft = { name: '', lat: '', lng: '', slug: '' }

const draft    = ref<LocationDraft>({ ...empty })
const baseline = ref<LocationDraft>({ ...empty })
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
        `MATCH (l:Location {slug: $slug}) RETURN l.slug AS slug LIMIT 1`,
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
  const snap: LocationDraft = {
    name: props.saved.canonicalName ?? '',
    lat:  props.saved.lat == null ? '' : String(props.saved.lat),
    lng:  props.saved.lng == null ? '' : String(props.saved.lng),
    slug: props.createMode ? 'new' : '',
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
  (Object.keys(draft.value) as (keyof LocationDraft)[]).some(k => draft.value[k] !== baseline.value[k]),
)

/** Returns the parsed value, or 'invalid' if non-empty and unparseable. */
function parseCoord(v: string): number | null | 'invalid' {
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : 'invalid'
}

// Picker only shows a marker when both fields parse.
const pickerLat = computed(() => {
  const lat = parseCoord(draft.value.lat), lng = parseCoord(draft.value.lng)
  return typeof lat === 'number' && typeof lng === 'number' ? lat : null
})
const pickerLng = computed(() => {
  const lat = parseCoord(draft.value.lat), lng = parseCoord(draft.value.lng)
  return typeof lat === 'number' && typeof lng === 'number' ? lng : null
})

function onPick(lat: number, lng: number) {
  draft.value.lat = String(lat)
  draft.value.lng = String(lng)
}

const canSave = computed(() => {
  const lat = parseCoord(draft.value.lat)
  const lng = parseCoord(draft.value.lng)
  if (lat === 'invalid' || lng === 'invalid') return false
  if (!props.createMode) return dirty.value && draft.value.name.trim().length > 0
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
      return
    }

    if (props.createMode) {
      const f = draft.value
      const res = await authFetch(`/api/admin/location/new`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug:          f.slug.trim(),
          canonicalName: f.name.trim(),
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
    if (f.name !== b.name) body.name = f.name.trim()
    if (f.lat  !== b.lat)  body.lat  = lat
    if (f.lng  !== b.lng)  body.lng  = lng
    if (!Object.keys(body).length) return

    const res = await authFetch(`/api/admin/location/${encodeURIComponent(props.slug)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as Partial<LocationNode> & { error?: string }
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
  get draft(): LocationDraft { return draft.value },
  get dirty(): boolean       { return dirty.value },
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
.edit-row-map { align-items: start; }
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
.edit-input-coord { font-family: var(--font-mono); font-size: var(--size-mono); max-width: 160px; }

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
