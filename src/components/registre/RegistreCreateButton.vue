<template>
  <div class="create-wrap">
    <button
      ref="btnRef"
      type="button"
      class="create-btn"
      :class="{ open }"
      @click="open = !open"
    >
      + Ny…
    </button>

    <div v-if="open" class="create-menu" @click.stop>
      <button type="button" class="create-menu-item" @click="pick('organization')">Organisasjon</button>
      <button type="button" class="create-menu-item" @click="pick('person')">Person</button>
      <button type="button" class="create-menu-item" @click="pick('unit')">Avdeling</button>
      <button type="button" class="create-menu-item" @click="pick('station')">Stasjon</button>
      <button type="button" class="create-menu-item" @click="pick('transport')">Fremkomstmiddel</button>
    </div>

    <AppModal v-model="modalOpen" :title="modalTitle">
      <div class="edit-row">
        <label class="edit-label" for="create-name">Navn</label>
        <input
          id="create-name"
          ref="nameRef"
          v-model="name"
          class="edit-input"
          type="text"
          autocomplete="off"
        />
      </div>

      <div class="edit-row">
        <label class="edit-label" for="create-slug">Slug</label>
        <div class="slug-field">
          <input
            id="create-slug"
            v-model="slug"
            class="edit-input"
            :class="{ locked: !slugEditable }"
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
      </div>

      <footer class="save-bar">
        <button type="button" class="btn-primary" :disabled="!canSave || saving" @click="save">
          {{ saving ? 'Oppretter…' : 'Opprett' }}
        </button>
        <button type="button" class="btn-revert" :disabled="saving" @click="modalOpen = false">Avbryt</button>
      </footer>
      <div v-if="error" class="save-error">{{ error }}</div>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import AppModal from '@/components/AppModal.vue'
import { authFetch } from '@/composables/useAuth.ts'
import { slugify, SLUG_RE } from '@/utils/slug.ts'

type Kind = 'organization' | 'person' | 'unit' | 'station' | 'transport'

const KIND_LABEL: Record<Kind, string> = {
  organization: 'organisasjon',
  person:       'person',
  unit:         'avdeling',
  station:      'stasjon',
  transport:    'fremkomstmiddel',
}

const KIND_ROUTE: Record<Kind, (slug: string) => string> = {
  organization: slug => `/organization/${slug}`,
  person:       slug => `/person/${slug}`,
  unit:         slug => `/district/${slug}`,
  station:      slug => `/station/${slug}`,
  transport:    slug => `/transport/${slug}`,
}

const router = useRouter()
const btnRef = ref<HTMLButtonElement | null>(null)
const nameRef = ref<HTMLInputElement | null>(null)

const open = ref(false)
const modalOpen = ref(false)
const kind = ref<Kind>('organization')

const name = ref('')
const slug = ref('')
const slugEdited = ref(false)
const slugEditable = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const modalTitle = computed(() => `Ny ${KIND_LABEL[kind.value]}`)
const canSave = computed(() => name.value.trim().length > 0 && SLUG_RE.test(slug.value))

watch(name, v => {
  if (!slugEdited.value) slug.value = slugify(v)
})

function pick(k: Kind) {
  open.value = false
  // Organization / Person / Avdeling use the in-page create flow on
  // /<type>/new; the rest still go through the modal until their pages
  // get the same treatment.
  if (k === 'organization') {
    router.push('/organization/new')
    return
  }
  if (k === 'person') {
    router.push('/person/new')
    return
  }
  if (k === 'unit') {
    router.push('/district/new')
    return
  }
  kind.value = k
  name.value = ''
  slug.value = ''
  slugEdited.value = false
  slugEditable.value = false
  error.value = null
  modalOpen.value = true
  void nextTick(() => nameRef.value?.focus())
}

function toggleSlugEdit() {
  if (!slugEditable.value) {
    slugEditable.value = true
    slugEdited.value = true
  } else {
    // Lock back — normalise whatever the user typed.
    slug.value = slugify(slug.value)
    slugEditable.value = false
  }
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = null
  try {
    const res = await authFetch(`/api/admin/${kind.value}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: slug.value, name: name.value.trim() }),
    })
    const body = await res.json().catch(() => ({})) as { slug?: string; error?: string }
    if (!res.ok) {
      error.value = body.error ?? `HTTP ${res.status}`
      // 409 collision → let the user edit the slug.
      if (res.status === 409) slugEditable.value = true
      return
    }
    const newSlug = body.slug ?? slug.value
    modalOpen.value = false
    router.push(KIND_ROUTE[kind.value](newSlug))
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

// Close dropdown on outside click.
function onDocClick(e: MouseEvent) {
  if (!open.value) return
  if (btnRef.value && btnRef.value.contains(e.target as Node)) return
  open.value = false
}
onMounted(()  => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.create-wrap { position: relative; display: inline-block; }

.create-btn {
  height: 32px;
  padding: 0 14px;
  background: var(--focus);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease-out;
}
.create-btn:hover { background: var(--faded-red); }
.create-btn.open { background: var(--faded-red); }

.create-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 180px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.create-menu-item {
  text-align: left;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  cursor: pointer;
}
.create-menu-item:hover { background: var(--paper-sunken); color: var(--faded-red); }

.edit-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-sm);
  align-items: center;
  margin-bottom: var(--space-sm);
}
.edit-label {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 600;
  color: var(--ink);
}
.edit-input {
  width: 100%;
  padding: 8px 10px;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}
.edit-input:focus { outline: 2px solid var(--focus); outline-offset: -1px; border-color: var(--focus); }
.edit-input.locked { background: var(--paper-sunken); color: var(--muted); font-family: var(--font-mono); font-size: var(--size-mono); }

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

.save-bar {
  margin-top: var(--space-md);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  justify-content: flex-end;
}
.btn-primary {
  padding: 8px 14px;
  background: var(--focus);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:hover { background: var(--faded-red); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-revert {
  background: transparent;
  border: none;
  padding: 0 8px;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--muted);
  text-decoration: underline;
  cursor: pointer;
}
.save-error {
  margin-top: var(--space-sm);
  padding: 8px 10px;
  background: var(--paper-sunken);
  border: 1px solid var(--faded-red);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--faded-red);
}
</style>
