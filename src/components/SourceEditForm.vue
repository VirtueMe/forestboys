<template>
  <form class="edit-form" @submit.prevent="submit">
    <div class="edit-title">Rediger kilde</div>
    <input v-model="form.title"          class="picker-input" type="text" placeholder="Tittel *" required />
    <input v-model="form.url"            class="picker-input" type="url"  placeholder="URL" />
    <input v-model="form.authorFreeText" class="picker-input" type="text" placeholder="Forfatter" />
    <select v-model="form.type" class="picker-input">
      <option value="website">Nettside</option>
      <option value="book">Bok</option>
      <option value="article">Artikkel</option>
      <option value="archive">Arkiv</option>
    </select>
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

interface SourceRef {
  id:             string
  title:          string | null
  url:            string | null
  authorFreeText: string | null
}

const props = defineProps<{ source: SourceRef }>()
const emit  = defineEmits<{
  saved:  [source: SourceRef]
  cancel: []
}>()

const form = ref({
  title:          props.source.title ?? '',
  url:            props.source.url ?? '',
  authorFreeText: props.source.authorFreeText ?? '',
  type:           'website',
})
const busy  = ref(false)
const error = ref<string | null>(null)

async function submit() {
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
  gap: 6px;
  padding: 10px;
  margin: 4px 0;
  background: var(--color-surface);
  border: 1px solid var(--color-navy);
  border-radius: 4px;
}

.edit-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-navy);
  margin-bottom: 2px;
}

.picker-input {
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-sizing: border-box;
  font-family: inherit;
}
.picker-input:focus {
  outline: 2px solid var(--color-navy);
  outline-offset: -1px;
  border-color: var(--color-navy);
}

.edit-error {
  font-size: 11px;
  color: #b91c1c;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
}

.edit-btn-cancel,
.edit-btn-save {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  border: none;
  font-family: inherit;
}
.edit-btn-cancel {
  background: transparent;
  color: var(--color-muted);
  border: 1px solid var(--color-border);
}
.edit-btn-save {
  background: var(--color-navy);
  color: #fff;
}
.edit-btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
