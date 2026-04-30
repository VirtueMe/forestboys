<template>
  <div v-if="entry" class="popup-scrim" @click="emit('close')">
    <div class="popup-card" role="dialog" aria-modal="true" @click.stop>
      <header class="popup-head">
        <h4 class="popup-title">{{ entry.targetName }}</h4>
        <button type="button" class="popup-close" aria-label="Lukk" @click="emit('close')">✕</button>
      </header>
      <div class="popup-sub">
        <span v-if="showRole && entry.role" class="relation-role">
          {{ roleOptions?.[entry.role] ?? entry.role }}
        </span>
        <span v-if="periodOf(entry)" class="member-period">{{ periodOf(entry) }}</span>
        <span v-if="showPassed && entry.passed === true" class="passed-chip passed-chip--ok">Bestått</span>
        <span v-if="showPassed && entry.passed === false" class="passed-chip passed-chip--no">Ikke bestått</span>
      </div>
      <template v-for="s in sortedSections" :key="s.order">
        <!-- eslint-disable vue/no-v-html -->
        <div
          class="popup-body portable-text"
          :class="{ 'is-quote': s.citations.length > 0 || s.sourcedFrom }"
          v-html="sectionHtml(s)"
        ></div>
        <!-- eslint-enable vue/no-v-html -->
        <div v-if="s.sourcedFrom" class="sourced-from">
          <span class="sourced-label">Fra:</span>
          <a
            v-if="s.sourcedFrom.url"
            :href="s.sourcedFrom.url"
            target="_blank"
            rel="noopener noreferrer"
            class="sourced-link"
          >{{ s.sourcedFrom.attribution || s.sourcedFrom.title || s.sourcedFrom.id }} ↗</a>
          <span v-else class="sourced-link">
            {{ s.sourcedFrom.attribution || s.sourcedFrom.title || s.sourcedFrom.id }}
          </span>
          <span v-if="s.sourcedFrom.license" class="sourced-license">{{ s.sourcedFrom.license }}</span>
        </div>
        <div v-if="inlineCites(s).length" class="inline-cites">
          <a
            v-for="c in inlineCites(s)"
            :key="c.source.id"
            :href="c.source.url ?? '#'"
            target="_blank"
            rel="noopener noreferrer"
            class="cite-chip"
          >
            {{ c.source.title || c.source.id }}
            <span v-if="c.source.authorFreeText" class="cite-chip-author">— {{ c.source.authorFreeText }}</span>
            <span class="cite-chip-arrow">↗</span>
          </a>
        </div>
      </template>
      <footer v-if="footnotes.length" class="card-kilder">
        <div class="kilder-label">Kilder</div>
        <ol class="kilder-list">
          <li v-for="c in footnotes" :key="c.source.id" :value="c.footnoteNumber">
            <component
              :is="c.source.url ? 'a' : 'span'"
              v-bind="c.source.url ? { href: c.source.url, target: '_blank', rel: 'noopener noreferrer' } : {}"
              class="kilder-ref"
            >
              {{ c.source.title || c.source.id
              }}<span v-if="c.source.authorFreeText" class="kilder-author"> — {{ c.source.authorFreeText }}</span>
            </component>
            <span v-if="c.source.url" class="kilder-arrow"> ↗</span>
          </li>
        </ol>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { blocksToHtml } from '@/utils/portableText.ts'
import type { Section, Citation } from '@/components/SectionsEditor.vue'
import type { RelationEntry } from './RelationStrategy.ts'

const props = withDefaults(defineProps<{
  entry:        RelationEntry | null
  showRole?:    boolean
  showPassed?:  boolean
  roleOptions?: Record<string, string>
}>(), {
  showRole:    false,
  showPassed:  false,
  roleOptions: undefined,
})

const emit = defineEmits<{ close: [] }>()

const sortedSections = computed<Section[]>(() =>
  props.entry ? [...props.entry.sections].sort((a, b) => a.order - b.order) : [],
)

function sectionHtml(s: Section): string {
  try { return blocksToHtml(JSON.parse(s.content) as unknown[]) } catch { return '' }
}

function inlineCites(s: Section): Citation[] { return s.citations.filter(c => c.inline) }

const footnotes = computed<(Citation & { footnoteNumber: number })[]>(() => {
  if (!props.entry) return []
  const out: (Citation & { footnoteNumber: number })[] = []
  for (const s of sortedSections.value) {
    for (const c of s.citations) {
      if (!c.inline) out.push({ ...c, footnoteNumber: out.length + 1 })
    }
  }
  return out
})

function periodOf(e: RelationEntry): string {
  if (!e.startDate && !e.endDate) return ''
  return `${e.startDate ?? '?'}${e.endDate ? ` – ${e.endDate}` : ''}`
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.entry) emit('close')
}
onMounted(() => { window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey) })
</script>

<style scoped>
.popup-scrim {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 26, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-md);
  z-index: 200;
}

.popup-card {
  max-width: 560px;
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: var(--space-lg);
}

.popup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-sm);
}

.popup-title {
  font-family: var(--font-serif);
  font-size: var(--size-h2);
  font-weight: 600;
  line-height: var(--leading-snug);
  color: var(--ink);
  margin: 0;
}

.popup-close {
  width: 28px;
  height: 28px;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: var(--radius-pill);
  cursor: pointer;
  color: var(--muted);
}
.popup-close:hover { border-color: var(--faded-red); color: var(--faded-red); }

.popup-sub {
  display: flex;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  flex-wrap: wrap;
  align-items: center;
}

.popup-body {
  font-family: var(--font-serif);
  font-size: var(--size-body);
  line-height: var(--leading-prose);
  color: var(--ink);
}
.popup-body :deep(p) { margin: 0 0 0.75em; }
.popup-body :deep(p:last-child) { margin-bottom: 0; }
.popup-body :deep(a) {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
}
.popup-body :deep(a:hover) {
  color: var(--faded-red);
  text-decoration-color: var(--faded-red);
}

.relation-role {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--ink-soft);
  padding: var(--space-xs) var(--space-sm);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
}

.member-period {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.is-quote {
  border-left: 2px solid var(--rule);
  padding: 2px var(--space-md);
  margin: var(--space-md) 0;
  font-style: italic;
  color: var(--ink-soft);
}

.sourced-from {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-xs);
  margin: calc(var(--space-sm) * -1) 0 var(--space-md) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
}
.sourced-label  {
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}
.sourced-link {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
}
.sourced-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }
.sourced-license {
  font-family: var(--font-mono);
  font-size: var(--size-caps);
  padding: var(--space-xs) var(--space-sm);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
  color: var(--muted);
}

.inline-cites {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin: var(--space-sm) 0;
}
.cite-chip {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
  text-decoration: none;
}
.cite-chip:hover       { color: var(--faded-red); }
.cite-chip-author      { color: var(--muted); }
.cite-chip-arrow       { font-size: var(--size-caps); opacity: 0.6; }

.card-kilder {
  border-top: 1px solid var(--rule);
  margin-top: var(--space-md);
  padding-top: var(--space-md);
}
.kilder-label {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: var(--space-sm);
}
.kilder-list {
  margin: 0;
  padding-left: var(--space-lg);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  line-height: var(--leading-normal);
}
.kilder-list li        { margin-bottom: var(--space-xs); }
.kilder-ref            { color: inherit; text-decoration: none; }
.kilder-list a.kilder-ref {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
}
.kilder-list a.kilder-ref:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }
.kilder-list a.kilder-ref .kilder-author { color: var(--muted); }
.kilder-arrow { font-size: var(--size-caps); opacity: 0.6; color: var(--ink); }

.passed-chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-xs) var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
}
.passed-chip--ok { background: var(--moss); color: var(--paper); }
.passed-chip--no { background: var(--paper-sunken); color: var(--danger); border-color: var(--rule); }
</style>
