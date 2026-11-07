<template>
  <div v-if="loading" class="status">Laster…</div>
  <div v-else-if="!isAdmin" class="status">Bare administratorer kan opprette en informasjonsside.</div>
  <div v-else class="admin-outline-new">
    <h2 class="page-heading">Ny informasjonsside</h2>
    <p class="intro">Et dokument som venter på at det lages et forslag fra det. Teksten, bildene og personene legger du inn på siden etterpå.</p>

    <div class="edit-row">
      <label class="edit-label" for="new-outline-name">Tittel</label>
      <input id="new-outline-name" v-model="name" class="edit-input" type="text" />
    </div>

    <div class="edit-row">
      <label class="edit-label" for="new-outline-slug">Slug</label>
      <div class="slug-stack">
        <div class="slug-field">
          <input
            id="new-outline-slug"
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
        <span v-if="slugTaken" class="slug-hint">Slug finnes allerede for en informasjonsside.</span>
      </div>
    </div>

    <footer class="edit-save-bar">
      <span class="edit-save-prompt">Opprett og skriv teksten?</span>
      <button type="button" class="edit-btn-primary" :disabled="!canSave || saving" @click="save">
        {{ saving ? 'Oppretter…' : 'Opprett' }}
      </button>
      <button type="button" class="edit-link-revert" :disabled="saving" @click="cancel">Avbryt</button>
    </footer>
    <div v-if="error" class="edit-save-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * AdminOutlineNewView — `/outlines/new` (#433): a title and a slug, then the new outline opens in edit mode.
 * The endpoint (`POST /api/admin/outline/new`) makes the node with no `sanityId`, which is what keeps the Sanity
 * sync away from it (docs/SANITY-SYNC.md, «Outlines»).
 */
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { authFetch, useAuth } from '../composables/useAuth.ts'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import { slugify, SLUG_RE } from '../utils/slug.ts'

const router = useRouter()
const { user, loading } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

const name = ref('')
const slug = ref('')
const saving = ref(false)
const error  = ref<string | null>(null)

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
      const rows = await neo4jQuery<{ slug: string }>(`MATCH (o:Outline {slug: $slug}) RETURN o.slug AS slug LIMIT 1`, { slug: s })
      if (slug.value === s) slugTaken.value = rows.length > 0
    } catch { /* silent: the server checks again on POST */ }
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
  return name.value.trim().length > 0 && SLUG_RE.test(s) && s !== 'new' && !slugTaken.value
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

function cancel() { router.back() }

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = null
  try {
    const res = await authFetch('/api/admin/outline/new', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: slug.value, canonicalName: name.value.trim() }),
    })
    const body = await res.json().catch(() => ({})) as { slug?: string; error?: string }
    if (!res.ok) {
      error.value = body.error ?? `HTTP ${res.status}`
      if (res.status === 409) { slugTaken.value = true; slugEditable.value = true }
      return
    }
    void router.push({ path: `/outlines/${body.slug ?? slug.value}`, query: { created: '1' } })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.admin-outline-new {
  max-width: 560px;
  margin: 24px auto;
  padding: 24px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 8px;
}
.status { padding: 24px; text-align: center; color: var(--muted); font-size: 14px; }
.intro { margin: 0 0 12px; font-size: 13px; color: var(--muted); }
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
