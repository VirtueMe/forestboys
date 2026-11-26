<template>
  <section class="section">
    <h2 class="section-heading"><label for="edit-outline-slug">Slug</label></h2>
    <SlugField
      id="edit-outline-slug"
      ref="slugField"
      v-model="draft"
      :saved="slug"
      route="/outlines/"
      :labels="['Outline']"
      taken-message="Slug finnes allerede for en informasjonsside."
    />
    <div v-if="dirty" class="slug-actions">
      <button type="button" class="slug-save" :disabled="busy || !slugField?.usable" @click="ask">
        {{ busy ? 'Vent…' : 'Endre adressen' }}
      </button>
      <button type="button" class="slug-revert" :disabled="busy" @click="revert">Angre</button>
    </div>
    <p v-if="error" class="slug-error">{{ error }}</p>
    <RenameConfirm
      v-model="open"
      :plan="plan"
      route="/outlines/"
      confirm-label="Endre adressen"
      warning="Siden lastes på nytt: ulagrede endringer i de andre feltene går tapt."
      :busy="busy"
      @confirm="rename"
    />
  </section>
</template>

<script setup lang="ts">
/**
 * OutlineSlugEditor — change an outline's address (#456). It has a button of its own and not the other editors' save:
 * they write to the slug the page has, so after a rename the page is loaded again under the new one.
 */
import { computed, ref, watch } from 'vue'
import SlugField from '@/components/SlugField.vue'
import RenameConfirm from '@/components/RenameConfirm.vue'
import { authFetch } from '@/composables/useAuth.ts'
import type { RenamePreview } from '@/utils/renameSummary.ts'

const props = defineProps<{ slug: string }>()
const emit = defineEmits<{ renamed: [slug: string] }>()

const slugField = ref<InstanceType<typeof SlugField> | null>(null)
const draft = ref(props.slug)
const busy  = ref(false)
const error = ref<string | null>(null)
const open  = ref(false)
const plan  = ref<RenamePreview | null>(null)

watch(() => props.slug, (s) => { draft.value = s; error.value = null })
watch(draft, () => { error.value = null })

const dirty = computed(() => draft.value !== props.slug)

function revert() {
  draft.value = props.slug
  slugField.value?.lock()
}

/** Both calls: the draft goes as it is, and an answer that is not ok is shown as it is. */
async function post<T>(action: 'rename-preview' | 'rename'): Promise<T | null> {
  busy.value  = true
  error.value = null
  try {
    const res = await authFetch(`/api/admin/outline/${encodeURIComponent(props.slug)}/${action}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: draft.value.trim() }),
    })
    const out = await res.json().catch(() => ({})) as T & { error?: string }
    if (res.ok) return out
    error.value = out.error ?? `HTTP ${res.status}`
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
  return null
}

/** Nothing is written by the question. */
async function ask() {
  const preview = await post<RenamePreview>('rename-preview')
  if (!preview) return
  plan.value = preview
  open.value = true
}

async function rename() {
  open.value = false
  const done = await post<{ slug: string }>('rename')
  if (done) emit('renamed', done.slug)
}
</script>

<style scoped>
.section { padding: var(--space-md); }
.section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 var(--space-md);
}
.slug-actions { display: flex; gap: var(--space-md); margin-top: var(--space-sm); }
.slug-save {
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  background: var(--faded-red);
  color: var(--paper);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.slug-save:disabled { background: var(--paper); color: var(--muted); cursor: not-allowed; }
.slug-revert {
  background: none;
  border: none;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink-soft);
  text-decoration: underline;
  cursor: pointer;
}
.slug-error {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
  margin: var(--space-sm) 0 0;
}
</style>
