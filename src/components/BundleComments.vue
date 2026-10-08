<template>
  <section class="comments" :aria-label="label">
    <form class="comment-form" @submit.prevent="add">
      <textarea
        v-model="text"
        rows="2"
        :maxlength="COMMENT_MAX"
        :placeholder="type === 'bundle' ? 'Skriv en kommentar til bundlen…' : 'Skriv en kommentar til enheten…'"
        :aria-label="label"
      ></textarea>
      <button type="submit" class="comment-add" :disabled="busy || !text.trim()">{{ busy ? 'Lagrer…' : 'Legg til' }}</button>
    </form>
    <p v-if="loading" class="muted">Laster…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <ol v-else-if="comments.length" class="comment-list">
      <li v-for="c in comments" :key="c.id" class="comment">
        <header class="comment-head">
          <strong>{{ actorName(c.actor) }}</strong>
          <time :datetime="c.at">{{ c.at.slice(0, 16).replace('T', ' ') }}</time>
          <button type="button" class="comment-remove" :disabled="busy" @click="remove(c.id)">Fjern</button>
        </header>
        <p class="comment-text">{{ c.text }}</p>
      </li>
    </ol>
    <p v-else class="muted">Ingen kommentarer ennå.</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import { actorName } from '@/utils/bundleEvents.ts'
import { COMMENT_MAX, type BundleComment } from '@/utils/bundleComments.ts'

const props = defineProps<{
  bundleId:  string
  type:      'bundle' | 'entity'
  entityId?: string
}>()
const emit = defineEmits<{ changed: [] }>()

const comments = ref<BundleComment[]>([])
const loading  = ref(true)
const busy     = ref(false)
const error    = ref<string | null>(null)
const text     = ref('')

const label = computed(() => props.type === 'bundle' ? 'Kommentarer til bundlen' : `Kommentarer til ${props.entityId}`)
const base  = computed(() => `/api/admin/proposals/${encodeURIComponent(props.bundleId)}/comments`)

async function load(): Promise<void> {
  const q = new URLSearchParams({ type: props.type, ...(props.entityId ? { entityId: props.entityId } : {}) })
  try {
    const res = await authFetch(`${base.value}?${q.toString()}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    comments.value = (await res.json() as { comments: BundleComment[] }).comments
    error.value = null
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function add(): Promise<void> {
  busy.value = true
  try {
    const res = await authFetch(base.value, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: props.type, ...(props.entityId ? { entityId: props.entityId } : {}), text: text.value }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    text.value = ''
    await load()
    emit('changed')
  } finally {
    busy.value = false
  }
}

async function remove(id: string): Promise<void> {
  if (!window.confirm('Fjerne kommentaren?')) return
  busy.value = true
  try {
    const res = await authFetch(`${base.value}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    await load()
    emit('changed')
  } finally {
    busy.value = false
  }
}

onMounted(() => { void load() })
</script>

<style scoped>
.comments { display: flex; flex-direction: column; gap: var(--space-sm); }
.muted { color: var(--muted); margin: 0; }
.error { color: var(--danger); margin: 0; }

.comment-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-sm); }
.comment { padding: var(--space-sm) var(--space-md); background: var(--paper-sunken); border: 1px solid var(--rule); border-radius: var(--radius-md); }
.comment-head { display: flex; align-items: baseline; gap: var(--space-md); }
.comment-head time { color: var(--muted); font-family: var(--font-mono); font-size: 12px; }
.comment-remove { margin-left: auto; background: none; border: 0; color: var(--muted); cursor: pointer; text-decoration: underline; font: inherit; font-size: 13px; }
.comment-remove:hover { color: var(--danger); }
.comment-text { margin: var(--space-xs) 0 0; white-space: pre-wrap; }

.comment-form { display: flex; flex-direction: column; gap: var(--space-xs); align-items: flex-start; }
.comment-form textarea { width: 100%; box-sizing: border-box; font: inherit; padding: var(--space-sm); background: var(--paper-raised); border: 1px solid var(--rule); border-radius: var(--radius-md); color: var(--ink); resize: vertical; }
.comment-add { font: inherit; padding: 4px 12px; cursor: pointer; background: var(--paper-sunken); border: 1px solid var(--rule); border-radius: var(--radius-md); color: var(--ink); }
.comment-add:disabled { opacity: .5; cursor: default; }
</style>
