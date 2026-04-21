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
        <span v-if="showPassed && entry.passed === true"  class="passed-chip passed-chip--ok">Bestått</span>
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
            >{{ c.source.title || c.source.id
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
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 200;
}

.popup-card {
  max-width: 560px;
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.3);
  padding: 20px 24px;
}

.popup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.popup-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-navy);
  margin: 0;
}

.popup-close {
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 14px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  cursor: pointer;
  color: var(--color-muted);
}
.popup-close:hover { border-color: var(--color-navy); color: var(--color-navy); }

.popup-sub {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 12px;
  color: var(--color-muted);
  flex-wrap: wrap;
  align-items: center;
}

.popup-body {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text);
}
.popup-body :deep(p) { margin: 0 0 0.75em; }
.popup-body :deep(p:last-child) { margin-bottom: 0; }
.popup-body :deep(a) { color: var(--color-navy); text-decoration: underline; }

.relation-role {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 1px 6px;
  border: 1px solid var(--color-border-mid);
  border-radius: 3px;
}

.member-period {
  font-size: 11px;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}

.is-quote {
  border-left: 3px solid var(--color-border);
  padding: 2px 14px;
  margin: 12px 0 12px 2px;
  font-style: italic;
  color: var(--color-text);
}

.sourced-from {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin: -6px 0 12px 18px;
  font-size: 11px;
  color: var(--color-muted);
}
.sourced-label  { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 10px; }
.sourced-link   { color: var(--color-navy); text-decoration: underline; }
.sourced-license {
  font-family: monospace;
  font-size: 10px;
  padding: 1px 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
}

.inline-cites {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 10px;
}
.cite-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  color: var(--color-navy);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  text-decoration: none;
}
.cite-chip:hover       { border-color: var(--color-navy); }
.cite-chip-author      { color: var(--color-muted); }
.cite-chip-arrow       { font-size: 10px; opacity: 0.6; }

.card-kilder {
  border-top: 1px solid var(--color-border);
  margin-top: 12px;
  padding-top: 10px;
}
.kilder-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 6px;
}
.kilder-list {
  margin: 0;
  padding-left: 22px;
  font-size: 11px;
  color: var(--color-muted);
  line-height: 1.5;
}
.kilder-list li        { margin-bottom: 3px; }
.kilder-ref            { color: inherit; text-decoration: none; }
.kilder-list a.kilder-ref { color: var(--color-navy); text-decoration: underline; }
.kilder-list a.kilder-ref .kilder-author { color: var(--color-muted); }
.kilder-arrow { font-size: 10px; opacity: 0.6; color: var(--color-navy); }

.passed-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 10px;
  border: 1px solid transparent;
}
.passed-chip--ok { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
.passed-chip--no { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
</style>
