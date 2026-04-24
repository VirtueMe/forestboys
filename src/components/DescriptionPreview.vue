<template>
  <template v-for="entry in renderedSections" :key="entry.order">
    <div class="section-wrap">
      <!-- eslint-disable vue/no-v-html -->
      <div
        class="portable-text"
        :class="{ 'is-quote': entry.section.citations.length > 0 || entry.section.sourcedFrom }"
        :itemprop="itemprop"
        v-html="entry.html"
      ></div>
      <!-- eslint-enable vue/no-v-html -->
      <div v-if="entry.section.sourcedFrom" class="sourced-from">
        <span class="sourced-label">Fra:</span>
        <a
          v-if="entry.section.sourcedFrom.url"
          :href="entry.section.sourcedFrom.url"
          target="_blank"
          rel="noopener noreferrer"
          class="sourced-link"
        >{{ entry.section.sourcedFrom.attribution || entry.section.sourcedFrom.title || entry.section.sourcedFrom.id }} ↗</a>
        <span v-else class="sourced-link">{{ entry.section.sourcedFrom.attribution || entry.section.sourcedFrom.title || entry.section.sourcedFrom.id }}</span>
        <span v-if="entry.section.sourcedFrom.license" class="sourced-license">{{ entry.section.sourcedFrom.license }}</span>
      </div>
      <div v-if="inlineCitesOf(entry.section).length" class="inline-cites">
        <a
          v-for="c in inlineCitesOf(entry.section)"
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
      <div v-if="sectionFootnoteCitesOf(entry.section).length" class="section-footnotes">
        <sup v-for="c in sectionFootnoteCitesOf(entry.section)" :key="c.source.id">[{{ c.footnoteNumber }}]</sup>
      </div>
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
</template>

<script setup lang="ts">
/**
 * DescriptionPreview — renders an array of `Section` records as the
 * "Beskrivelse" preview body: stacked paragraphs with sourced-from
 * attribution, inline citation chips, footnote markers, and a Kilder
 * footer.
 *
 * Caller owns the wrapping `<section>` / heading / collapsibility — this
 * component renders only the content. Sections are sorted by `order`
 * inside.
 */
import { computed } from 'vue'
import { blocksToHtml } from '@/utils/portableText.ts'
import type { Section, Citation } from '@/components/SectionsEditor.vue'

const props = withDefaults(defineProps<{
  sections: Section[]
  /** Optional schema.org itemprop applied to each rendered paragraph. */
  itemprop?: string | undefined
}>(), {
  itemprop: undefined,
})

interface RenderedSection {
  order:   number
  html:    string
  section: Section
}

const sortedSections = computed<Section[]>(() =>
  [...props.sections].sort((a, b) => a.order - b.order),
)

const renderedSections = computed<RenderedSection[]>(() =>
  sortedSections.value.map(s => {
    let html = ''
    try { html = blocksToHtml(JSON.parse(s.content) as unknown[]) } catch { /* skip */ }
    return { order: s.order, html, section: s }
  }),
)

const footnotes = computed<(Citation & { footnoteNumber: number })[]>(() => {
  const out: (Citation & { footnoteNumber: number })[] = []
  for (const s of sortedSections.value) {
    for (const c of s.citations) {
      if (!c.inline) out.push({ ...c, footnoteNumber: out.length + 1 })
    }
  }
  return out
})

function inlineCitesOf(s: Section): Citation[] { return s.citations.filter(c => c.inline) }
function sectionFootnoteCitesOf(s: Section): (Citation & { footnoteNumber: number })[] {
  return footnotes.value.filter(fn => s.citations.some(c => !c.inline && c.source.id === fn.source.id))
}
</script>

<style scoped>
.section-wrap { position: relative; }
.section-wrap + .section-wrap { margin-top: var(--space-sm); }

.portable-text {
  font-family: var(--font-serif);
  font-size: var(--size-body);
  line-height: var(--leading-prose);
  color: var(--ink);
  max-width: var(--prose-max-width);
}

.is-quote {
  border-left: 2px solid var(--rule);
  padding: 2px var(--space-md);
  margin: var(--space-md) 0;
  font-style: italic;
  color: var(--ink-soft);
}

.portable-text :deep(p) { margin: 0 0 0.75em; }
.portable-text :deep(p:last-child) { margin-bottom: 0; }

.portable-text :deep(ul),
.portable-text :deep(ol) {
  margin: 0.5em 0 0.75em;
  padding-left: 1.5em;
}
.portable-text :deep(li) { margin: 0.25em 0; }

.portable-text :deep(h1),
.portable-text :deep(h2),
.portable-text :deep(h3),
.portable-text :deep(h4) {
  font-family: var(--font-serif);
  font-size: var(--size-h3);
  font-weight: 600;
  margin: 1em 0 0.4em;
  color: var(--ink);
}

.portable-text :deep(strong) { font-weight: 600; }
.portable-text :deep(em)     { font-style: italic; }
.portable-text :deep(a) {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  cursor: pointer;
}
.portable-text :deep(a:hover) {
  color: var(--faded-red);
  text-decoration-color: var(--faded-red);
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
.sourced-label {
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
.cite-chip:hover  { color: var(--faded-red); }
.cite-chip-author { color: var(--muted); }
.cite-chip-arrow  { font-size: var(--size-caps); opacity: 0.6; }

.section-footnotes {
  position: absolute;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 2px;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
}

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
</style>
