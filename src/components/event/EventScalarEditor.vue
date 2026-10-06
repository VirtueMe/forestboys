<template>
  <section class="edit-section">
    <h2 class="edit-section-heading">{{ kindLabel }}</h2>

    <div class="edit-row">
      <label class="edit-label">Klassifisering</label>
      <div class="kind-stack">
        <div class="type-seg">
          <label class="type-seg-opt" :class="{ active: draft.kind === 'incident', disabled: incidentDisabled }">
            <input v-model="draft.kind" type="radio" value="incident" :disabled="incidentDisabled" />
            <span class="type-seg-label">
              Hendelse
              <button
                v-if="hasDemoteBlockers && baseline.kind === 'operation'"
                type="button"
                class="info-marker"
                :class="{ open: blockerOpen }"
                aria-label="Vis blokkerende koblinger"
                @click.stop.prevent="blockerOpen = true"
              >i</button>
            </span>
          </label>
          <label class="type-seg-opt" :class="{ active: draft.kind === 'operation' }">
            <input v-model="draft.kind" type="radio" value="operation" />
            Operasjon
          </label>
        </div>
      </div>
    </div>

    <AppModal v-model="blockerOpen" title="Blokkerer endring til hendelse">
      <div class="blocker-modal-body">
        <p class="blocker-intro">
          Denne operasjonen har koblinger som hendelser ikke har. Fjern dem
          først, eller bekreft for å fjerne alle og endre klassifisering.
        </p>
        <div v-if="demoteBlockers.orgs.length" class="blocker-group">
          <h4 class="blocker-heading">Organisasjoner</h4>
          <ul class="blocker-list">
            <li v-for="o in demoteBlockers.orgs" :key="o.slug">
              <RouterLink :to="`/organization/${o.slug}`" @click="blockerOpen = false">{{ o.name }}</RouterLink>
            </li>
          </ul>
        </div>
        <div v-if="demoteBlockers.units.length" class="blocker-group">
          <h4 class="blocker-heading">Avdelinger</h4>
          <ul class="blocker-list">
            <li v-for="u in demoteBlockers.units" :key="u.slug">
              <RouterLink :to="`/district/${u.slug}`" @click="blockerOpen = false">{{ u.name }}</RouterLink>
            </li>
          </ul>
        </div>
        <footer class="blocker-actions">
          <button type="button" class="blocker-cancel" @click="blockerOpen = false">Avbryt</button>
          <button
            type="button"
            class="blocker-force-btn"
            :disabled="saving"
            @click="forceDemote"
          >
            Fjern alle koblinger og endre
          </button>
        </footer>
      </div>
    </AppModal>

    <div class="edit-row">
      <label class="edit-label" for="edit-event-name">{{ nameLabel }}</label>
      <input id="edit-event-name" v-model="draft.name" class="edit-input" type="text" required />
    </div>

    <div class="edit-row">
      <label class="edit-label" for="edit-event-slug">Slug</label>
      <div class="slug-stack">
        <div class="slug-field">
          <input
            id="edit-event-slug"
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
        <span v-if="slugTaken" class="slug-hint">Slug finnes allerede for en hendelse eller operasjon.</span>
      </div>
    </div>

    <div class="edit-row">
      <label class="edit-label" for="edit-event-date">Dato</label>
      <input
        id="edit-event-date"
        v-model="draft.date"
        class="edit-input edit-input-narrow"
        type="text"
        placeholder="YYYY-MM-DD"
      />
    </div>
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
 * EventScalarEditor — Grunnleggende edit form for an Incident/Operation
 * (kind, name, date). Owns draft + save. Emits `saved` with the server
 * response so the parent can refresh its event ref. Kind flips go through
 * a separate /kind endpoint (full edge rewrite) and trigger `kindFlipped`.
 *
 * Mirrors PersonScalarEditor: defineExpose({ draft, dirty }) so the parent
 * preview overlay can reflect unsaved values.
 */
import { ref, computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import AppModal from '@/components/AppModal.vue'
import { authFetch } from '@/composables/useAuth.ts'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { slugify, SLUG_RE } from '@/utils/slug.ts'
import type { EventKind, EventNode } from '@/composables/useEventData.ts'

export interface DemoteBlockers {
  orgs:  { slug: string; name: string }[]
  units: { slug: string; name: string }[]
}

interface SaveResponse {
  name?:  string
  date?:  string | null
  slug?:  string
  error?: string
}

export interface EventScalarDraft {
  name: string
  date: string
  slug: string
  kind: EventKind
}

const props = withDefaults(defineProps<{
  saved:           EventNode
  /** Edges that block a demote (Operation → Incident). Surfaced via an
   *  (i) marker next to the "Hendelse" radio. Default empty. */
  demoteBlockers?: DemoteBlockers
}>(), {
  demoteBlockers: () => ({ orgs: [], units: [] }),
})

const emit = defineEmits<{
  saved:       [updates: SaveResponse]
  kindFlipped: [kind: EventKind]
  slugChanged: [newSlug: string]
}>()

const draft        = ref<EventScalarDraft>({ name: '', date: '', slug: '', kind: 'incident' })
const baseline     = ref<EventScalarDraft>({ name: '', date: '', slug: '', kind: 'incident' })
const saving       = ref(false)
const error        = ref<string | null>(null)
const blockerOpen  = ref(false)

const slugEditable = ref(false)
const slugTaken    = ref(false)
const slugChecking = ref(false)
let slugCheckTimer: ReturnType<typeof setTimeout> | null = null

watch(() => draft.value.slug, (s) => {
  // Reset taken flag whenever the input changes; only the latest value
  // matters for save eligibility.
  slugTaken.value    = false
  slugChecking.value = false
  if (slugCheckTimer) clearTimeout(slugCheckTimer)
  if (s === baseline.value.slug) return       // unchanged — nothing to check
  if (!SLUG_RE.test(s) || s === 'new') return
  slugChecking.value = true
  slugCheckTimer = setTimeout(async () => {
    try {
      const rows = await neo4jQuery<{ slug: string }>(
        `MATCH (n {slug: $slug}) WHERE n:Incident OR n:Operation RETURN n.slug AS slug LIMIT 1`,
        { slug: s },
      )
      if (draft.value.slug === s) slugTaken.value = rows.length > 0
    } catch { /* silent — server still validates on PATCH */ }
    finally {
      if (draft.value.slug === s) slugChecking.value = false
    }
  }, 250)
})

const slugState = computed<'neutral' | 'invalid' | 'valid'>(() => {
  const s = draft.value.slug.trim()
  if (!s || s === baseline.value.slug) return 'neutral'
  if (!SLUG_RE.test(s) || s === 'new')  return 'invalid'
  if (slugChecking.value) return 'neutral'
  if (slugTaken.value)    return 'invalid'
  return 'valid'
})

function toggleSlugEdit() {
  if (!slugEditable.value) {
    slugEditable.value = true
  } else {
    draft.value.slug = slugify(draft.value.slug)
    slugEditable.value = false
  }
}

const hasDemoteBlockers = computed(() =>
  props.demoteBlockers.orgs.length > 0 || props.demoteBlockers.units.length > 0,
)

// "Hendelse" radio is disabled while saved kind is "operation" and
// blocker edges exist. Admin clicks the (i) marker to see what's
// blocking and optionally force-demote.
const incidentDisabled = computed(() =>
  baseline.value.kind === 'operation' && hasDemoteBlockers.value,
)

function snapshot() {
  const snap: EventScalarDraft = {
    name: props.saved.canonicalName ?? '',
    date: props.saved.date ?? '',
    slug: props.saved.slug ?? '',
    kind: props.saved.kind,
  }
  draft.value    = { ...snap }
  baseline.value = { ...snap }
  error.value    = null
  slugEditable.value = false
  slugTaken.value    = false
}
watch(() => props.saved, snapshot, { immediate: true, deep: true })

const dirty = computed(() =>
  draft.value.name !== baseline.value.name ||
  draft.value.date !== baseline.value.date ||
  draft.value.slug !== baseline.value.slug ||
  draft.value.kind !== baseline.value.kind,
)

const canSave = computed(() => {
  if (!dirty.value) return false
  if (draft.value.slug !== baseline.value.slug) {
    const s = draft.value.slug.trim()
    if (!SLUG_RE.test(s) || s === 'new' || slugTaken.value) return false
  }
  return true
})

const kindLabel = computed(() => draft.value.kind === 'operation' ? 'Operasjon' : 'Hendelse')
const nameLabel = computed(() => draft.value.kind === 'operation' ? 'Kodenavn' : 'Tittel')

function revert() {
  draft.value = { ...baseline.value }
  error.value = null
}

/** PATCH /event/:slug/kind. Returns true on success, false on 409
 *  (blockers) or any other error — caller should bail. The blockers
 *  popover stays the source of truth for the user's "force" path. */
async function flipKind(slug: string, force: boolean): Promise<boolean> {
  const res = await authFetch(`/api/admin/event/${encodeURIComponent(slug)}/kind`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ kind: draft.value.kind, ...(force ? { force: true } : {}) }),
  })
  const body = await res.json().catch(() => ({})) as { kind?: EventKind; error?: string; blockers?: DemoteBlockers }
  if (!res.ok) {
    if (res.status === 409 && body.blockers) {
      // Demote refused: surface the marker popover (in case the proactive
      // list was stale) and keep the segment on its current saved value.
      blockerOpen.value = true
      draft.value.kind  = baseline.value.kind
      error.value       = body.error ?? 'Kan ikke endre klassifisering — fjern blokkerende koblinger først.'
    } else {
      error.value = body.error ?? `HTTP ${res.status}`
    }
    return false
  }
  emit('kindFlipped', draft.value.kind)
  baseline.value.kind = draft.value.kind
  blockerOpen.value   = false
  return true
}

async function forceDemote() {
  if (saving.value) return
  const slug = props.saved.slug
  if (!slug) return
  if (!window.confirm(
    'Bekreft: Alle organisasjons- og avdelingskoblinger fjernes når denne operasjonen blir til en hendelse.',
  )) return
  saving.value = true
  error.value  = null
  try {
    draft.value.kind = 'incident'
    await flipKind(slug, true)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function save() {
  if (!dirty.value || saving.value) return
  const slug = props.saved.slug
  if (!slug) return
  saving.value = true
  error.value  = null
  try {
    // Kind flip first — it changes the node label, so subsequent
    // name/date PATCH must run after.
    if (draft.value.kind !== baseline.value.kind) {
      const ok = await flipKind(slug, false)
      if (!ok) return
    }

    const body: Record<string, unknown> = {}
    if (draft.value.name !== baseline.value.name) body.name = draft.value.name.trim()
    if (draft.value.date !== baseline.value.date) body.date = draft.value.date.trim() || null
    if (draft.value.slug !== baseline.value.slug) body.slug = draft.value.slug.trim()
    if (Object.keys(body).length) {
      const res = await authFetch(`/api/admin/event/${encodeURIComponent(slug)}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const out = await res.json().catch(() => ({})) as SaveResponse
      if (!res.ok) {
        if (res.status === 409 && body.slug) {
          slugTaken.value    = true
          slugEditable.value = true
        }
        error.value = out.error ?? `HTTP ${res.status}`
        return
      }
      emit('saved', out)
      // Slug rename: the URL must change; tell parents so they can navigate.
      if (out.slug && out.slug !== slug) emit('slugChanged', out.slug)
    }
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
.edit-input-narrow { max-width: 160px; }
.edit-input.locked { background: var(--paper-sunken); color: var(--muted); font-family: var(--font-mono); font-size: var(--size-mono); }
.edit-input.slug-valid   { color: var(--moss);   border-color: var(--moss); }
.edit-input.slug-invalid { color: var(--danger); border-color: var(--danger); }

.slug-stack { display: flex; flex-direction: column; gap: var(--space-xs); }
.slug-field { display: flex; gap: var(--space-xs); }
.slug-toggle {
  flex-shrink: 0;
  width: 36px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  font-size: var(--size-body-ui);
  color: var(--ink-soft);
  cursor: pointer;
}
.slug-toggle:hover { background: var(--paper-sunken); color: var(--faded-red); }
.slug-hint {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}

.kind-stack { display: flex; flex-direction: column; gap: var(--space-sm); position: relative; }

.type-seg {
  display: inline-flex;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  overflow: hidden;
  align-self: flex-start;
}
.type-seg-label { display: inline-flex; align-items: center; gap: var(--space-sm); }

.info-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  color: var(--paper);
  background: var(--faded-red);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
}
.info-marker:hover,
.info-marker.open { background: var(--faded-red-soft); }

.blocker-modal-body {
  padding: var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.blocker-intro { margin: 0; color: var(--ink-soft); line-height: 1.5; }
.blocker-group { display: flex; flex-direction: column; gap: var(--space-xs); }
.blocker-heading {
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin: 0;
}
.blocker-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-xs); }
.blocker-list a {
  color: var(--faded-red);
  text-decoration: none;
  font-size: var(--size-body-ui);
}
.blocker-list a:hover { text-decoration: underline; }

.blocker-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
  padding-top: var(--space-md);
  border-top: 1px solid var(--rule);
}
.blocker-cancel {
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  background: transparent;
  color: var(--ink-soft);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.blocker-cancel:hover { background: var(--paper-sunken); }

.blocker-force-btn {
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  background: var(--danger);
  color: var(--paper);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.blocker-force-btn:hover:not(:disabled) { background: var(--faded-red-soft); border-color: var(--faded-red-soft); }
.blocker-force-btn:disabled { opacity: 0.5; cursor: not-allowed; }
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
.type-seg-opt.disabled {
  cursor: not-allowed;
  color: var(--muted);
  background: var(--paper-sunken);
}

@media (max-width: 520px) {
  .edit-row { grid-template-columns: 1fr; gap: var(--space-xs); }
}

.edit-save-bar {
  margin: var(--space-md);
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
  margin: 0 var(--space-md) var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-sunken);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}
</style>
