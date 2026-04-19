<template>
  <span v-if="refs?.length" class="source-refs">
    <span
      v-for="(ref, i) in parsedRefs"
      :key="ref.raw"
      class="source-ref-wrap"
    >
      <button
        type="button"
        class="source-chip"
        :class="{ 'source-chip--open': openIndex === i }"
        :aria-expanded="openIndex === i"
        @click="toggle(i)"
      >
        <span class="source-chip-icon" aria-hidden="true">§</span>
        <span class="source-chip-title">{{ chipLabel(ref) }}</span>
        <span v-if="ref.fragmentLabel" class="source-chip-fragment">{{ ref.fragmentLabel }}</span>
      </button>
      <div v-if="openIndex === i" class="source-popover" role="dialog">
        <header class="source-popover-header">
          <span v-if="resolved(ref.id)?.type" class="source-popover-type">{{ typeLabel(resolved(ref.id)!.type) }}</span>
          <button class="source-popover-close" type="button" aria-label="Lukk" @click="openIndex = null">×</button>
        </header>
        <p class="source-popover-title">{{ chipLabel(ref) }}</p>
        <p v-if="ref.fragmentLabel" class="source-popover-meta">Referanse: {{ ref.fragmentLabel }}</p>
        <p v-if="resolved(ref.id)?.domain" class="source-popover-meta">{{ resolved(ref.id)!.domain }}</p>
        <a
          v-if="resolved(ref.id)?.url"
          :href="resolved(ref.id)!.url!"
          target="_blank"
          rel="noopener noreferrer"
          class="source-popover-link"
        >Åpne kilde ↗</a>
        <p v-else-if="!resolved(ref.id)" class="source-popover-meta source-popover-missing">
          Kilden finnes ikke i grafen ennå ({{ ref.id }}).
        </p>
      </div>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { resolveSources, getCachedSource, type ResolvedSource } from '../composables/useSourceRefs.ts'

const props = defineProps<{ refs: string[] | null | undefined }>()

const openIndex = ref<number | null>(null)

interface ParsedRef {
  raw: string
  id: string
  fragment: string | null
  fragmentLabel: string | null
}

function parseRef(raw: string): ParsedRef {
  const hashIdx = raw.indexOf('#')
  if (hashIdx === -1) return { raw, id: raw, fragment: null, fragmentLabel: null }
  const id = raw.slice(0, hashIdx)
  const fragment = raw.slice(hashIdx + 1)
  return { raw, id, fragment, fragmentLabel: formatFragment(fragment) }
}

// Fragment grammar: <kind>:<entry>[,<entry>]*  where entry = point | start..end
function formatFragment(fragment: string): string | null {
  const colonIdx = fragment.indexOf(':')
  if (colonIdx === -1) return null
  const kind = fragment.slice(0, colonIdx)
  const rest = fragment.slice(colonIdx + 1)
  const entries = rest.split(',').map(e => e.replace('..', '–'))
  const label = ({
    page:  's.',
    line:  'linje',
    chars: '',
    block: 'blokk',
    time:  '',
  } as Record<string, string>)[kind] ?? kind
  const joined = entries.join(', ')
  return label ? `${label} ${joined}` : joined
}

const parsedRefs = computed<ParsedRef[]>(() => (props.refs ?? []).map(parseRef))

function resolved(id: string): ResolvedSource | null {
  return getCachedSource(id)
}

function chipLabel(ref: ParsedRef): string {
  const r = resolved(ref.id)
  if (r?.title) return truncate(r.title, 48)
  return ref.id
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

const TYPE_LABELS: Record<string, string> = {
  book:         'Bok',
  website:      'Nettside',
  registry:     'Register',
  encyclopedia: 'Leksikon',
  reference:    'Oppslagsverk',
  newspaper:    'Avis',
  map:          'Kart',
  archive:      'Arkiv',
  video:        'Video',
  academic:     'Akademisk',
  report:       'Rapport',
  editorial:    'Redaksjonell vurdering',
  photograph:   'Fotografi',
}
function typeLabel(type: string | null): string {
  if (!type) return ''
  return TYPE_LABELS[type] ?? type
}

function toggle(i: number) {
  openIndex.value = openIndex.value === i ? null : i
}

function onDocClick(e: MouseEvent) {
  if (openIndex.value === null) return
  const target = e.target as HTMLElement
  if (!target.closest('.source-ref-wrap')) openIndex.value = null
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') openIndex.value = null
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
  void resolveSources((props.refs ?? []).map(r => parseRef(r).id))
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

watch(() => props.refs, refs => {
  void resolveSources((refs ?? []).map(r => parseRef(r).id))
})
</script>

<style scoped>
.source-refs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: 6px;
  vertical-align: middle;
}

.source-ref-wrap {
  position: relative;
  display: inline-block;
}

.source-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
  background: var(--color-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.1s, background 0.1s, color 0.1s;
  -webkit-tap-highlight-color: transparent;
}
.source-chip:hover,
.source-chip--open {
  border-color: var(--color-navy);
  color: var(--color-navy);
  background: var(--color-bg);
}

.source-chip-icon {
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
}

.source-chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.source-chip-fragment {
  font-size: 10px;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.source-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 240px;
  max-width: 320px;
  padding: 10px 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text);
}

.source-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.source-popover-type {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.source-popover-close {
  width: 22px;
  height: 22px;
  background: none;
  border: 0;
  color: var(--color-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  border-radius: 3px;
  -webkit-tap-highlight-color: transparent;
}
.source-popover-close:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.source-popover-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.35;
}

.source-popover-meta {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--color-muted);
}

.source-popover-missing {
  font-style: italic;
}

.source-popover-link {
  display: inline-block;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-navy);
  text-decoration: none;
}
.source-popover-link:hover { text-decoration: underline; }
</style>
