<template>
  <section class="edit-section">
    <h3 class="edit-section-heading">{{ kindLabel }}</h3>

    <div class="edit-row">
      <label class="edit-label">Klassifisering</label>
      <div class="type-seg">
        <label class="type-seg-opt" :class="{ active: draft.kind === 'incident' }">
          <input v-model="draft.kind" type="radio" value="incident" />
          Hendelse
        </label>
        <label class="type-seg-opt" :class="{ active: draft.kind === 'operation' }">
          <input v-model="draft.kind" type="radio" value="operation" />
          Operasjon
        </label>
      </div>
    </div>

    <div class="edit-row">
      <label class="edit-label" for="edit-event-name">{{ nameLabel }}</label>
      <input id="edit-event-name" v-model="draft.name" class="edit-input" type="text" required />
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
    <button type="button" class="edit-btn-primary" :disabled="saving" @click="save">
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
import { authFetch } from '@/composables/useAuth.ts'
import type { EventKind, EventNode } from '@/composables/useEventData.ts'

interface SaveResponse {
  name?:  string
  date?:  string | null
  error?: string
}

export interface EventScalarDraft {
  name: string
  date: string
  kind: EventKind
}

const props = defineProps<{
  saved: EventNode
}>()

const emit = defineEmits<{
  saved:       [updates: SaveResponse]
  kindFlipped: [kind: EventKind]
}>()

const draft    = ref<EventScalarDraft>({ name: '', date: '', kind: 'incident' })
const baseline = ref<EventScalarDraft>({ name: '', date: '', kind: 'incident' })
const saving   = ref(false)
const error    = ref<string | null>(null)

function snapshot() {
  const snap: EventScalarDraft = {
    name: props.saved.canonicalName ?? '',
    date: props.saved.date ?? '',
    kind: props.saved.kind,
  }
  draft.value    = { ...snap }
  baseline.value = { ...snap }
  error.value    = null
}
watch(() => props.saved, snapshot, { immediate: true, deep: true })

const dirty = computed(() =>
  draft.value.name !== baseline.value.name ||
  draft.value.date !== baseline.value.date ||
  draft.value.kind !== baseline.value.kind,
)

const kindLabel = computed(() => draft.value.kind === 'operation' ? 'Operasjon' : 'Hendelse')
const nameLabel = computed(() => draft.value.kind === 'operation' ? 'Kodenavn' : 'Tittel')

function revert() {
  draft.value = { ...baseline.value }
  error.value = null
}

async function save() {
  if (!dirty.value || saving.value) return
  const slug = props.saved.slug
  if (!slug) return
  saving.value = true
  error.value  = null
  try {
    // Kind flip first — it rewrites edges and changes the node label,
    // so subsequent name/date PATCH must run after.
    if (draft.value.kind !== baseline.value.kind) {
      const label = draft.value.kind === 'operation' ? 'Operasjon' : 'Hendelse'
      if (!window.confirm(
        `Endre klassifisering til ${label}? Dette skriver om edges (INVOLVED_IN/PARTICIPATED_IN, notater, hierarki).`,
      )) {
        draft.value.kind = baseline.value.kind
        saving.value = false
        return
      }
      const res = await authFetch(`/api/admin/event/${encodeURIComponent(slug)}/kind`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ kind: draft.value.kind }),
      })
      const body = await res.json().catch(() => ({})) as { kind?: EventKind; error?: string }
      if (!res.ok) {
        error.value = body.error ?? `HTTP ${res.status}`
        return
      }
      emit('kindFlipped', draft.value.kind)
      baseline.value.kind = draft.value.kind
    }

    const body: Record<string, unknown> = {}
    if (draft.value.name !== baseline.value.name) body.name = draft.value.name.trim()
    if (draft.value.date !== baseline.value.date) body.date = draft.value.date.trim() || null
    if (Object.keys(body).length) {
      const res = await authFetch(`/api/admin/event/${encodeURIComponent(slug)}`, {
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
