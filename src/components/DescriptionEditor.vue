<template>
  <section class="edit-section">
    <h3 class="edit-section-heading">{{ label }}</h3>
    <SectionsEditor :sections="draft" />
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
 * DescriptionEditor — owns a draft of `Section[]` for an entity's
 * Beskrivelse, the save bar, and the PATCH call.
 *
 * Parent passes the saved sections + the endpoint to PATCH. After save,
 * the component emits `saved` so the parent can update its source ref.
 *
 * The draft + dirty flag are exposed via defineExpose so the parent can
 * overlay them in a sibling DescriptionPreview while still in edit mode.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import SectionsEditor, { type Section } from '@/components/SectionsEditor.vue'

const props = withDefaults(defineProps<{
  /** Authoritative saved sections (sorted, hydrated). */
  saved:    Section[]
  /** PATCH endpoint URL. Body is `{ sections: [...] }`. */
  endpoint: string
  /** Heading shown above the editor. */
  label?:   string
}>(), {
  label: 'Beskrivelse',
})

const emit = defineEmits<{ saved: [sections: Section[]] }>()

function cloneSection(s: Section): Section {
  return {
    ...s,
    citations:   s.citations.map(c => ({ ...c, source: { ...c.source } })),
    sourcedFrom: s.sourcedFrom ? { ...s.sourcedFrom } : null,
  }
}

function signature(arr: Section[]): string {
  return JSON.stringify(
    [...arr].sort((a, b) => a.order - b.order).map(s => [
      s.order,
      s.content,
      s.citations.map(c => [c.inline, c.source.id]),
      s.sourcedFrom?.id ?? null,
    ]),
  )
}

const draft    = ref<Section[]>([])
const baseline = ref<Section[]>([])
const saving   = ref(false)
const error    = ref<string | null>(null)

function snapshot() {
  draft.value    = props.saved.map(cloneSection)
  baseline.value = props.saved.map(cloneSection)
  error.value    = null
}
watch(() => props.saved, snapshot, { immediate: true, deep: true })

const dirty = computed(() => signature(draft.value) !== signature(baseline.value))

function revert() {
  draft.value = baseline.value.map(cloneSection)
  error.value = null
}

async function save() {
  saving.value = true
  error.value  = null
  try {
    const payload = {
      sections: [...draft.value]
        .sort((a, b) => a.order - b.order)
        .map(s => ({
          order:         s.order,
          content:       s.content,
          citations:     s.citations.map(c => ({ inline: c.inline, sourceId: c.source.id })),
          sourcedFromId: s.sourcedFrom?.id ?? null,
        })),
    }
    const res = await authFetch(props.endpoint, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    const saved = draft.value.map(cloneSection)
    baseline.value = saved
    emit('saved', saved)
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
