<template>
  <div class="slug-stack">
    <div class="slug-field">
      <input
        :id="id"
        :value="modelValue"
        class="slug-input"
        :class="{ locked: !editable, [`slug-${state}`]: true }"
        :readonly="!editable"
        type="text"
        placeholder="kebab-case"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="slug-toggle" :aria-label="editable ? 'Lås slug' : 'Rediger slug'" @click="toggle">
        {{ editable ? '✓' : '✎' }}
      </button>
    </div>
    <span v-if="taken" class="slug-hint">{{ takenByAlias ? 'Slug er et gammelt navn på en annen side.' : takenMessage }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * SlugField — a page's slug in an editor: locked until ✎, checked while it is typed against the live pages and the old
 * addresses on the same route (#96). The parent owns the value and the save; `usable` says whether it may be saved,
 * and `refuse()` is for the server's 409. Used by the event and the outline editor.
 */
import { computed, ref, watch } from 'vue'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { slugify, SLUG_RE } from '@/utils/slug.ts'

const props = defineProps<{
  id:           string
  modelValue:   string
  /** The slug the page has now. */
  saved:        string
  /** The address space, e.g. `/events/`. */
  route:        string
  /** The node labels that share the route. */
  labels:       string[]
  takenMessage: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const editable     = ref(false)
const taken        = ref(false)
const takenByAlias = ref(false)
const checking     = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

watch(() => props.modelValue, (s) => {
  taken.value = false
  takenByAlias.value = false
  checking.value = false
  if (timer) clearTimeout(timer)
  if (s === props.saved) return       // unchanged — nothing to check
  if (!SLUG_RE.test(s) || s === 'new') return
  checking.value = true
  timer = setTimeout(async () => {
    try {
      // A live page, or the old address of another page (#96): either way the slug is taken.
      const rows = await neo4jQuery<{ slug: string; alias: boolean }>(
        `MATCH (n {slug: $slug}) WHERE any(l IN labels(n) WHERE l IN $labels) RETURN n.slug AS slug, false AS alias LIMIT 1
         UNION
         MATCH (a:SlugAlias {route: $route, slug: $slug})-[:ALIAS_OF]->(t) WHERE t.slug <> $own
         RETURN a.slug AS slug, true AS alias LIMIT 1`,
        { slug: s, own: props.saved, route: props.route, labels: props.labels },
      )
      if (props.modelValue === s) {
        taken.value        = rows.length > 0
        takenByAlias.value = rows.some(r => r.alias)
      }
    } catch { /* silent — the server still validates on save */ }
    finally {
      if (props.modelValue === s) checking.value = false
    }
  }, 250)
})

// A new saved slug (another page, or a rename just made): lock again.
watch(() => props.saved, () => { editable.value = false; taken.value = false })

const state = computed<'neutral' | 'invalid' | 'valid'>(() => {
  const s = props.modelValue.trim()
  if (!s || s === props.saved) return 'neutral'
  if (!SLUG_RE.test(s) || s === 'new') return 'invalid'
  if (checking.value) return 'neutral'
  return taken.value ? 'invalid' : 'valid'
})

const usable = computed(() => {
  const s = props.modelValue.trim()
  return SLUG_RE.test(s) && s !== 'new' && !taken.value
})

function toggle() {
  if (editable.value) emit('update:modelValue', slugify(props.modelValue))
  editable.value = !editable.value
}

function refuse() {
  taken.value = true
  editable.value = true
}

function lock() { editable.value = false }

defineExpose({ usable, refuse, lock })
</script>

<style scoped>
.slug-stack { display: flex; flex-direction: column; gap: var(--space-xs); }
.slug-field { display: flex; gap: var(--space-xs); }
.slug-input {
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
.slug-input:focus {
  outline: 1px solid var(--focus);
  outline-offset: 0;
  border-color: var(--focus);
}
.slug-input.locked { background: var(--paper-sunken); color: var(--muted); font-family: var(--font-mono); font-size: var(--size-mono); }
.slug-input.slug-valid   { color: var(--moss);   border-color: var(--moss); }
.slug-input.slug-invalid { color: var(--danger); border-color: var(--danger); }
.slug-toggle {
  flex-shrink: 0;
  width: 36px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  font-size: var(--size-body-ui);
  color: var(--ink-soft);
  cursor: pointer;
}
.slug-toggle:hover { background: var(--paper-sunken); color: var(--faded-red); }
.slug-hint {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}
</style>
