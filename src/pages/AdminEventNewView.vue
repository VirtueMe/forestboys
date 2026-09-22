<template>
  <div class="admin-event-new">
    <h2 class="page-heading">Ny {{ kindLabel }}</h2>

    <div class="edit-row">
      <label class="edit-label">Type</label>
      <div class="type-seg">
        <label class="type-seg-opt" :class="{ active: kind === 'incident' }">
          <input v-model="kind" type="radio" value="incident" />
          Hendelse
        </label>
        <label class="type-seg-opt" :class="{ active: kind === 'operation' }">
          <input v-model="kind" type="radio" value="operation" />
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
      />
    </div>

    <div class="edit-row">
      <label class="edit-label" for="new-event-slug">Slug</label>
      <div class="slug-stack">
        <div class="slug-field">
          <input
            id="new-event-slug"
            v-model="slug"
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

    <div v-if="forOrg" class="edit-row">
      <label class="edit-label">Knyttes til org</label>
      <span class="for-person">{{ forOrg }}</span>
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
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '../composables/useAuth.ts'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import { slugify, SLUG_RE } from '../utils/slug.ts'

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
const forOrg    = ref(typeof route.query.forOrg    === 'string' ? route.query.forOrg    : '')
const returnTo  = typeof route.query.returnTo  === 'string' ? route.query.returnTo  : ''

const saving = ref(false)
const error  = ref<string | null>(null)

const kindLabel = computed(() => kind.value === 'operation' ? 'operasjon' : 'hendelse')

const slugEdited   = ref(false)
const slugEditable = ref(false)
const slugTaken    = ref(false)
const slugChecking = ref(false)
let slugCheckTimer: ReturnType<typeof setTimeout> | null = null

watch(name, (v) => {
  if (slugEdited.value) return
  slug.value = slugify(v)
})

watch(slug, (s) => {
  slugTaken.value    = false
  slugChecking.value = false
  if (slugCheckTimer) clearTimeout(slugCheckTimer)
  if (!SLUG_RE.test(s) || s === 'new') return
  slugChecking.value = true
  slugCheckTimer = setTimeout(async () => {
    try {
      const rows = await neo4jQuery<{ slug: string }>(
        `MATCH (n {slug: $slug}) WHERE n:Incident OR n:Operation RETURN n.slug AS slug LIMIT 1`,
        { slug: s },
      )
      if (slug.value === s) slugTaken.value = rows.length > 0
    } catch { /* silent — server still validates on POST */ }
    finally {
      if (slug.value === s) slugChecking.value = false
    }
  }, 250)
})

const slugState = computed<'neutral' | 'invalid' | 'valid'>(() => {
  const s = slug.value.trim()
  if (!s || s === 'new') return 'neutral'
  if (!SLUG_RE.test(s))  return 'invalid'
  if (slugChecking.value) return 'neutral'
  if (slugTaken.value)    return 'invalid'
  return 'valid'
})

const canSave = computed(() => {
  const s = slug.value.trim()
  return name.value.trim().length > 0
    && SLUG_RE.test(s)
    && s !== 'new'
    && !slugTaken.value
})

function toggleSlugEdit() {
  if (!slugEditable.value) {
    slugEditable.value = true
    slugEdited.value = true
  } else {
    slug.value = slugify(slug.value)
    slugEditable.value = false
  }
}

function cancel() {
  if (returnTo) void router.push(returnTo)
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
        forOrg:    forOrg.value    || null,
      }),
    })
    const body = await res.json().catch(() => ({})) as { slug?: string; error?: string }
    if (!res.ok) {
      error.value = body.error ?? `HTTP ${res.status}`
      if (res.status === 409) {
        slugTaken.value    = true
        slugEditable.value = true
      }
      return
    }
    const newSlug = body.slug ?? slug.value
    // Prefer returnTo with auto-expand hint; fall back to the event's own page.
    if (returnTo) {
      void router.push({ path: returnTo, query: { expandEvent: newSlug } })
    } else {
      void router.push(`/events/${newSlug}`)
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
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 8px;
}
.page-heading {
  font-size: 18px;
  font-weight: 700;
  color: var(--focus);
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
.edit-label { font-size: 12px; font-weight: 600; color: var(--ink); }
.edit-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 14px;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 4px;
  box-sizing: border-box;
  font-family: inherit;
}
.edit-input:focus { outline: 2px solid var(--focus); outline-offset: -1px; border-color: var(--focus); }
.edit-input-date { font-family: monospace; font-size: 12px; max-width: 160px; }
.edit-input.locked { background: var(--paper-sunken); color: var(--muted); font-family: var(--font-mono); font-size: var(--size-mono); }
.edit-input.slug-valid   { color: var(--moss);   border-color: var(--moss); }
.edit-input.slug-invalid { color: var(--danger); border-color: var(--danger); }

.slug-stack { display: flex; flex-direction: column; gap: 4px; }
.slug-field { display: flex; gap: 4px; }
.slug-toggle {
  flex-shrink: 0;
  width: 36px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 4px;
  font-size: 14px;
  color: var(--ink-soft);
  cursor: pointer;
}
.slug-toggle:hover { background: var(--paper-sunken); color: var(--faded-red); }
.slug-hint {
  font-size: 12px;
  color: var(--danger);
}
.type-seg {
  display: inline-flex;
  border: 1px solid var(--rule);
  border-radius: 4px;
  overflow: hidden;
}
.type-seg-opt {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
}
.type-seg-opt + .type-seg-opt { border-left: 1px solid var(--rule); }
.type-seg-opt input[type="radio"] {
  position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none;
}
.type-seg-opt.active { background: var(--focus); color: #fff; font-weight: 600; }
.for-person { font-size: 13px; color: var(--muted); font-family: monospace; }
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
  background: var(--focus);
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
