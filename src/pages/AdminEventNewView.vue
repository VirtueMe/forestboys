<template>
  <div class="admin-event-new">
    <h2 class="page-heading">Ny {{ kindLabel }}</h2>

    <div class="edit-row">
      <label class="edit-label">Type</label>
      <div class="type-seg">
        <label class="type-seg-opt" :class="{ active: kind === 'incident' }">
          <input type="radio" value="incident" v-model="kind" />
          Hendelse
        </label>
        <label class="type-seg-opt" :class="{ active: kind === 'operation' }">
          <input type="radio" value="operation" v-model="kind" />
          Operasjon
        </label>
      </div>
    </div>

    <div class="edit-row">
      <label class="edit-label" for="new-event-name">{{ kind === 'operation' ? 'Kodenavn' : 'Tittel' }}</label>
      <input
        id="new-event-name"
        v-model="name"
        class="edit-input"
        type="text"
        @input="autoSlug"
      />
    </div>

    <div class="edit-row">
      <label class="edit-label" for="new-event-slug">Slug</label>
      <input
        id="new-event-slug"
        v-model="slug"
        class="edit-input"
        type="text"
        placeholder="kebab-case"
      />
    </div>

    <div class="edit-row">
      <label class="edit-label" for="new-event-date">Dato</label>
      <input
        id="new-event-date"
        v-model="date"
        class="edit-input edit-input-date"
        type="text"
        placeholder="YYYY-MM-DD"
      />
    </div>

    <div v-if="forPerson" class="edit-row">
      <label class="edit-label">Knyttes til person</label>
      <span class="for-person">{{ forPerson }}</span>
    </div>

    <footer class="edit-save-bar">
      <span class="edit-save-prompt">Opprett og gå tilbake?</span>
      <button type="button" class="edit-btn-primary" :disabled="!canSave || saving" @click="save">
        {{ saving ? 'Oppretter…' : 'Opprett' }}
      </button>
      <button type="button" class="edit-link-revert" :disabled="saving" @click="cancel">Avbryt</button>
    </footer>
    <div v-if="error" class="edit-save-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '../composables/useAuth.ts'

type Kind = 'incident' | 'operation'

const route  = useRoute()
const router = useRouter()

const kind = ref<Kind>(
  route.query.kind === 'operation' ? 'operation' : 'incident',
)
const name      = ref('')
const slug      = ref('')
const date      = ref('')
const forPerson = ref(typeof route.query.forPerson === 'string' ? route.query.forPerson : '')
const returnTo  = typeof route.query.returnTo  === 'string' ? route.query.returnTo  : ''

const saving = ref(false)
const error  = ref<string | null>(null)

const kindLabel = computed(() => kind.value === 'operation' ? 'operasjon' : 'hendelse')
const canSave   = computed(() => name.value.trim().length > 0 && /^[a-z0-9-]+$/.test(slug.value))

let slugEdited = false
function autoSlug() {
  if (slugEdited) return
  slug.value = name.value
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function cancel() {
  if (returnTo) router.push(returnTo)
  else router.back()
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = null
  try {
    const res = await authFetch('/api/admin/event', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind:      kind.value,
        slug:      slug.value,
        name:      name.value.trim(),
        date:      date.value.trim() || null,
        forPerson: forPerson.value || null,
      }),
    })
    const body = await res.json().catch(() => ({})) as { slug?: string; error?: string }
    if (!res.ok) {
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    const newSlug = body.slug ?? slug.value
    // Prefer returnTo with auto-expand hint; fall back to the event's own page.
    if (returnTo) {
      router.push({ path: returnTo, query: { expandEvent: newSlug } })
    } else {
      router.push(`/events/${newSlug}`)
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.admin-event-new {
  max-width: 560px;
  margin: 24px auto;
  padding: 24px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
}
.page-heading {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-navy);
  margin: 0 0 16px;
  text-transform: capitalize;
}
.edit-row {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}
.edit-label { font-size: 12px; font-weight: 600; color: var(--color-text); }
.edit-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-sizing: border-box;
  font-family: inherit;
}
.edit-input:focus { outline: 2px solid var(--color-navy); outline-offset: -1px; border-color: var(--color-navy); }
.edit-input-date { font-family: monospace; font-size: 12px; max-width: 160px; }
.type-seg {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  overflow: hidden;
}
.type-seg-opt {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--color-muted);
  cursor: pointer;
}
.type-seg-opt + .type-seg-opt { border-left: 1px solid var(--color-border); }
.type-seg-opt input[type="radio"] {
  position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none;
}
.type-seg-opt.active { background: var(--color-navy); color: #fff; font-weight: 600; }
.for-person { font-size: 13px; color: var(--color-muted); font-family: monospace; }
.edit-save-bar {
  margin-top: 16px;
  padding: 10px 14px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.edit-save-prompt { flex: 1; font-size: 13px; color: #92400e; font-weight: 600; }
.edit-btn-primary {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  background: var(--color-navy);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.edit-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.edit-link-revert {
  background: transparent; border: none; padding: 0;
  font-size: 12px; color: #92400e; text-decoration: underline; cursor: pointer;
}
.edit-save-error {
  margin-top: 8px;
  padding: 8px 10px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 12px;
  color: #b91c1c;
}
</style>
