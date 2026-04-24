<template>
  <form class="edit-form" @submit.prevent="submit">
    <div class="edit-title">Rediger kilde</div>
    <input v-model="form.title"          class="picker-input" type="text" placeholder="Tittel *" required />
    <input v-model="form.url"            class="picker-input" type="url"  placeholder="URL" @blur="autoFill" />
    <input v-model="form.authorFreeText" class="picker-input" type="text" placeholder="Forfatter" />
    <div class="form-row">
      <select v-model="form.type" class="picker-input">
        <option value="website">Nettside</option>
        <option value="book">Bok</option>
        <option value="article">Artikkel</option>
        <option value="archive">Arkiv</option>
      </select>
      <LicensePicker v-model="form.license" />
    </div>
    <input v-model="form.attribution" class="picker-input" type="text" placeholder="Attribusjon (for gjenbruk)" />

    <div v-if="error" class="edit-error">{{ error }}</div>
    <div class="edit-actions">
      <button type="button" class="edit-btn-cancel" @click="emit('cancel')">Avbryt</button>
      <button type="submit" class="edit-btn-save" :disabled="busy || !form.title.trim()">
        {{ busy ? 'Lagrer…' : 'Lagre' }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import { licenseForUrl, attributionForUrl, normalizeLicense, NOASSERTION } from '@/utils/licenseForDomain.ts'
import LicensePicker from '@/components/LicensePicker.vue'

interface SourceRef {
  id:             string
  title:          string | null
  url:            string | null
  authorFreeText: string | null
  license?:       string | null
  attribution?:   string | null
}

const props = defineProps<{ source: SourceRef }>()
const emit  = defineEmits<{
  saved:  [source: SourceRef]
  cancel: []
}>()

const form = ref({
  title:          props.source.title          ?? '',
  url:            props.source.url            ?? '',
  authorFreeText: props.source.authorFreeText ?? '',
  type:           'website',
  license:        normalizeLicense(props.source.license),
  attribution:    props.source.attribution ?? '',
})
const busy  = ref(false)
const error = ref<string | null>(null)

function autoFill() {
  if (!form.value.url) return
  if (form.value.license === NOASSERTION) form.value.license = licenseForUrl(form.value.url)
  if (!form.value.attribution) {
    const attr = attributionForUrl(form.value.url)
    if (attr) form.value.attribution = attr
  }
}

async function submit() {
  autoFill() // fires even if the URL input didn't blur before submit
  busy.value = true
  error.value = null
  try {
    const res = await authFetch(`/api/admin/sources/${encodeURIComponent(props.source.id)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        title:          form.value.title.trim(),
        url:            form.value.url.trim() || null,
        authorFreeText: form.value.authorFreeText.trim() || null,
        type:           form.value.type,
        license:        form.value.license,
        attribution:    form.value.attribution.trim() || null,
      }),
    })
    const body = await res.json().catch(() => ({})) as Partial<SourceRef> & { error?: string }
    if (!res.ok || !body.id) {
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    emit('saved', {
      id:             body.id,
      title:          body.title          ?? null,
      url:            body.url            ?? null,
      authorFreeText: body.authorFreeText ?? null,
      license:        body.license        ?? null,
      attribution:    body.attribution    ?? null,
    })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  margin: var(--space-xs) 0;
  background: var(--paper-raised);
  border: 1px solid var(--focus);
  border-radius: var(--radius-md);
}

.edit-title {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--ink-soft);
  margin-bottom: var(--space-xs);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}

.picker-input {
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
.picker-input:focus {
  outline: 1px solid var(--focus);
  outline-offset: 0;
  border-color: var(--focus);
}

.edit-error {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}

.edit-btn-cancel,
.edit-btn-save {
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  border-radius: var(--radius-md);
  cursor: pointer;
  border: none;
}
.edit-btn-cancel {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--rule);
}
.edit-btn-cancel:hover { background: var(--paper-sunken); }
.edit-btn-save {
  background: var(--faded-red);
  color: var(--paper);
}
.edit-btn-save:hover:not(:disabled) { background: var(--faded-red-soft); }
.edit-btn-save:disabled { background: var(--paper-sunken); color: var(--muted); cursor: not-allowed; }
</style>
