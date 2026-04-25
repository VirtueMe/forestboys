<template>
  <div class="edit-pane">
    <section class="edit-section">
      <h3 class="edit-section-heading">Nytt fremkomstmiddel</h3>

      <div class="edit-row">
        <label class="edit-label" for="new-transport-name">Navn</label>
        <input id="new-transport-name" v-model="draft.name" class="edit-input" type="text" required />
      </div>

      <div class="edit-row">
        <label class="edit-label" for="new-transport-slug">Slug</label>
        <div class="slug-stack">
          <div class="slug-field">
            <input
              id="new-transport-slug"
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
            >{{ slugEditable ? '✓' : '✎' }}</button>
          </div>
          <span v-if="slugTaken" class="slug-hint">Slug finnes allerede for et fremkomstmiddel.</span>
        </div>
      </div>

      <div class="edit-row">
        <label class="edit-label" for="new-transport-type">Type</label>
        <input
          id="new-transport-type"
          v-model="draft.type"
          class="edit-input"
          type="text"
          placeholder="f.eks. båt, fly, bil, tog"
        />
      </div>
    </section>

    <footer class="edit-save-bar">
      <span class="edit-save-prompt">Opprett fremkomstmiddel?</span>
      <button type="button" class="edit-btn-primary" :disabled="saving || !canSave" @click="save">
        {{ saving ? 'Oppretter…' : 'Opprett' }}
      </button>
    </footer>
    <div v-if="error" class="edit-save-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * TransportCreateForm — the /transport/new create branch. Standalone
 * form with name + slug + type. Slug auto-syncs from name with the
 * shared ✎-override + debounced Neo4j probe pattern.
 *
 * Emits `created` with the real slug so the page can navigate to
 * /transport/:slug.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { slugify, SLUG_RE } from '@/utils/slug.ts'

interface Draft {
  name: string
  slug: string
  type: string
}

const emit = defineEmits<{ created: [slug: string] }>()

const draft = ref<Draft>({ name: '', slug: 'new', type: '' })
const saving = ref(false)
const error  = ref<string | null>(null)

const slugEdited   = ref(false)
const slugEditable = ref(false)
const slugTaken    = ref(false)
const slugChecking = ref(false)
let slugCheckTimer: ReturnType<typeof setTimeout> | null = null

watch(() => draft.value.name, (v) => {
  if (slugEdited.value) return
  draft.value.slug = slugify(v)
})

watch(() => draft.value.slug, (s) => {
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
    } catch { /* silent — server still validates on POST */ }
    finally {
      if (draft.value.slug === s) slugChecking.value = false
    }
  }, 250)
})

const slugState = computed<'neutral' | 'invalid' | 'valid'>(() => {
  const s = draft.value.slug.trim()
  if (!s || s === 'new') return 'neutral'
  if (!SLUG_RE.test(s)) return 'invalid'
  if (slugChecking.value) return 'neutral'
  if (slugTaken.value)    return 'invalid'
  return 'valid'
})

const canSave = computed(() => {
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

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value  = null
  try {
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
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.edit-pane {
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  padding: var(--space-lg);
}
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
  transition: background 120ms ease-out, color 120ms ease-out;
}
.slug-toggle:hover { background: var(--paper-sunken); color: var(--faded-red); }
.slug-hint {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
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
