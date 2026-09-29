<template>
  <div class="source-refs-editor">
    <ul v-if="modelValue.length" class="sre-list">
      <li v-for="(raw, i) in modelValue" :key="`${i}:${idOf(raw)}`" class="sre-row">
        <span class="sre-icon" aria-hidden="true">§</span>
        <span class="sre-title" :title="idOf(raw)">{{ titleOf(raw) }}</span>
        <input
          class="edit-input sre-locator"
          type="text"
          placeholder="side, f.eks. 47 eller 47–52"
          :aria-label="`Side eller sted i ${titleOf(raw)}`"
          :value="locatorOf(raw)"
          @change="setLocator(i, ($event.target as HTMLInputElement).value)"
        />
        <button type="button" class="sre-remove" :aria-label="`Fjern ${titleOf(raw)}`" @click="remove(i)">✕</button>
      </li>
    </ul>
    <p v-if="error" class="sre-error">{{ error }}</p>
    <SourcePicker placeholder="Legg til kilde…" @pick="s => add(s.id)" />
  </div>
</template>

<script setup lang="ts">
/**
 * SourceRefsEditor — edits a claim's evidence: a list of SourceRef strings
 * (`<source-id>[#<kind>:<entry>,…]`, docs/SCHEMA.md). Each row is a Source
 * plus an optional locator: pages are typed as "47", "47–52" or "47, 89";
 * anything else is kept as a raw fragment ("time:02:34..03:15").
 *
 * Distinct from a description's citations, which back the text; these back
 * the claim itself (a rank, a stay) — a document, a page.
 */
import { ref, watch } from 'vue'
import SourcePicker from '@/components/SourcePicker.vue'
import { getCachedSource, resolveSources } from '@/composables/useSourceRefs.ts'

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [refs: string[]] }>()

const error = ref<string | null>(null)

const idOf = (raw: string) => raw.split('#')[0]
const fragmentOf = (raw: string) => raw.split('#')[1] ?? ''
const titleOf = (raw: string) => getCachedSource(idOf(raw))?.title || idOf(raw)

watch(() => props.modelValue, refs => { void resolveSources(refs.map(idOf)) }, { immediate: true })

/** page:47..52,89 → "47–52, 89"; other kinds shown raw. */
function locatorOf(raw: string): string {
  const f = fragmentOf(raw)
  if (!f) return ''
  if (!f.startsWith('page:')) return f
  return f.slice(5).split(',').map(e => e.replace('..', '–')).join(', ')
}

/** "47–52, 89" → page:47..52,89; "kind:…" kept as is; empty → no fragment. */
function toFragment(input: string): string | null | undefined {
  const t = input.trim()
  if (!t) return null
  if (/^[a-z]+:\S/.test(t)) return t
  const entries = t.split(',').map(e => e.trim().replace(/\s*[–-]\s*/, '..')).filter(Boolean)
  if (entries.every(e => /^\w+(\.\.\w+)?$/.test(e))) return `page:${entries.join(',')}`
  return undefined
}

function setLocator(i: number, input: string) {
  const fragment = toFragment(input)
  if (fragment === undefined) {
    error.value = `Forstår ikke «${input}» — skriv en side (47), et spenn (47–52) eller flere (47, 89).`
    return
  }
  error.value = null
  const next = [...props.modelValue]
  next[i] = fragment ? `${idOf(next[i])}#${fragment}` : idOf(next[i])
  emit('update:modelValue', next)
}

function add(id: string) {
  error.value = null
  emit('update:modelValue', [...props.modelValue, id])
}

function remove(i: number) {
  emit('update:modelValue', props.modelValue.filter((_, j) => j !== i))
}
</script>

<style scoped>
.sre-list {
  list-style: none;
  margin: 0 0 var(--space-sm);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.sre-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 11rem auto;
  align-items: center;
  gap: var(--space-sm);
}
.sre-icon  { font-family: var(--font-serif); color: var(--muted); }
.sre-title {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sre-locator { width: 100%; }
.sre-remove {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--rule);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.sre-remove:hover { border-color: var(--danger); color: var(--danger); }
.sre-error {
  margin: 0 0 var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}
@media (max-width: 480px) {
  .sre-row { grid-template-columns: auto minmax(0, 1fr) auto; }
  .sre-locator { grid-column: 2 / 4; }
}
</style>
