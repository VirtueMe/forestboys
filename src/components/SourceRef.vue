<template>
  <span v-if="refs?.length" class="source-refs">
    <span
      v-for="(r, i) in parsedRefs"
      :key="r.raw"
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
        <span class="source-chip-title">{{ chipLabel(r) }}</span>
        <span v-if="r.fragmentLabel" class="source-chip-fragment">{{ r.fragmentLabel }}</span>
      </button>
      <div v-if="openIndex === i" class="source-popover" role="dialog">
        <header class="source-popover-header">
          <span v-if="resolved(r.id)?.type" class="source-popover-type">{{ typeLabel(resolved(r.id)!.type) }}</span>
          <button class="source-popover-close" type="button" aria-label="Lukk" @click="openIndex = null">×</button>
        </header>
        <p class="source-popover-title">{{ chipLabel(r) }}</p>
        <p v-if="r.fragmentLabel" class="source-popover-meta">Referanse: {{ r.fragmentLabel }}</p>
        <p v-if="resolved(r.id)?.domain" class="source-popover-meta">{{ resolved(r.id)!.domain }}</p>
        <a
          v-if="resolved(r.id)?.url"
          :href="resolved(r.id)!.url!"
          target="_blank"
          rel="noopener noreferrer"
          class="source-popover-link"
        >Åpne kilde ↗</a>
        <p v-else-if="!resolved(r.id)" class="source-popover-meta source-popover-missing">
          Kilden finnes ikke i grafen ennå ({{ r.id }}).
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
  gap: var(--space-xs);
  margin-left: var(--space-xs);
  vertical-align: middle;
}

.source-ref-wrap {
  position: relative;
  display: inline-block;
}

.source-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  max-width: 200px;
  padding: var(--space-xs) var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 500;
  color: var(--ink-soft);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: background 120ms ease-out, color 120ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.source-chip:hover,
.source-chip--open {
  background: var(--ink);
  color: var(--paper);
}

.source-chip-icon {
  font-weight: 600;
  font-size: var(--size-label);
  line-height: 1;
}

.source-chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.source-chip-fragment {
  font-family: var(--font-mono);
  font-size: var(--size-caps);
  color: inherit;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.source-popover {
  position: absolute;
  top: calc(100% + var(--space-xs));
  left: 0;
  z-index: 50;
  min-width: 240px;
  max-width: 320px;
  padding: var(--space-md);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  line-height: var(--leading-normal);
  color: var(--ink);
}

.source-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-xs);
}

.source-popover-type {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
}

.source-popover-close {
  width: 22px;
  height: 22px;
  background: none;
  border: 0;
  color: var(--muted);
  font-size: var(--size-h3);
  line-height: 1;
  cursor: pointer;
  padding: 0;
  border-radius: var(--radius-md);
  -webkit-tap-highlight-color: transparent;
}
.source-popover-close:hover {
  background: var(--paper-sunken);
  color: var(--faded-red);
}

.source-popover-title {
  margin: 0 0 var(--space-xs);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 600;
  color: var(--ink);
  line-height: var(--leading-snug);
}

.source-popover-meta {
  margin: 0 0 var(--space-xs);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
}

.source-popover-missing {
  font-style: italic;
}

.source-popover-link {
  display: inline-block;
  margin-top: var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
}
.source-popover-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }
</style>
