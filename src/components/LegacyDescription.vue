<template>
  <!-- eslint-disable vue/no-v-html -->
  <div v-if="html" class="rich-text" :itemprop="itemprop" v-html="html"></div>
  <!-- eslint-enable vue/no-v-html -->
  <p v-else-if="text" class="plain-text" :itemprop="itemprop">{{ text }}</p>
</template>

<script setup lang="ts">
/**
 * LegacyDescription — renders the Sanity-era Beskrivelse fallback for
 * pages whose entities haven't been migrated to the HAS_CONTENT
 * Description model yet.
 *
 * Prefers the pre-rendered `html` (Portable Text → HTML) when present,
 * otherwise falls back to plain `text` (whitespace preserved).
 *
 * Rendering nothing is correct when both are empty — caller can wrap in
 * `v-if="html || text"` if the surrounding heading should also hide.
 */
withDefaults(defineProps<{
  html?:     string | null
  text?:     string | null
  /** Optional schema.org itemprop applied to the rendered element. */
  itemprop?: string | undefined
}>(), {
  html:     null,
  text:     null,
  itemprop: undefined,
})
</script>

<style scoped>
.plain-text {
  font-family: var(--font-serif);
  font-size: var(--size-body);
  line-height: var(--leading-prose);
  color: var(--ink);
  margin: 0;
  white-space: pre-line;
  max-width: var(--prose-max-width);
}

.rich-text {
  font-family: var(--font-serif);
  font-size: var(--size-body);
  line-height: var(--leading-prose);
  color: var(--ink);
  max-width: var(--prose-max-width);
}
.rich-text :deep(p) { margin: 0 0 0.75em; }
.rich-text :deep(p:last-child) { margin-bottom: 0; }
.rich-text :deep(h1),
.rich-text :deep(h2),
.rich-text :deep(h3),
.rich-text :deep(h4) {
  font-family: var(--font-serif);
  font-weight: 600;
  margin: 1em 0 0.4em;
  color: var(--ink);
}
.rich-text :deep(ul),
.rich-text :deep(ol) { padding-left: 1.4em; margin: 0.5em 0; }
.rich-text :deep(li) { margin: 0.2em 0; }
.rich-text :deep(strong) { font-weight: 600; }
.rich-text :deep(em) { font-style: italic; }
.rich-text :deep(blockquote) {
  border-left: 2px solid var(--rule);
  margin: 0.75em 0;
  padding-left: var(--space-md);
  color: var(--ink-soft);
  font-style: italic;
}
.rich-text :deep(a) {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
}
.rich-text :deep(a:hover) { color: var(--faded-red); text-decoration-color: var(--faded-red); }
.rich-text :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--paper-sunken);
  padding: 1px var(--space-xs);
  border-radius: var(--radius-sm);
}
</style>
