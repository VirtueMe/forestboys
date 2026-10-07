<template>
  <article v-if="source" class="src-preview">
    <header class="src-head">
      <span class="src-kind">Kilde<template v-if="source.type"> · {{ source.type }}</template></span>
      <h1 class="src-title">{{ source.title || source.id }}</h1>
      <dl class="src-meta">
        <div v-if="source.authorFreeText"><dt>Forfatter</dt><dd>{{ source.authorFreeText }}</dd></div>
        <div v-if="source.publishedDate"><dt>Utgitt</dt><dd>{{ source.publishedDate }}</dd></div>
        <div v-if="source.url">
          <dt>Lenke</dt>
          <dd><a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.url }} ↗</a></dd>
        </div>
      </dl>
    </header>

    <section v-if="descriptionHtml" class="src-section">
      <h2 class="src-section-heading">Beskrivelse</h2>
      <!-- eslint-disable vue/no-v-html -->
      <div class="portable-text" v-html="descriptionHtml"></div>
      <!-- eslint-enable vue/no-v-html -->
    </section>

    <section v-if="referrers.length" class="src-section">
      <h2 class="src-section-heading">Referert fra ({{ referrers.length }})</h2>
      <ul class="src-referrers">
        <li v-for="r in referrers" :key="`${r.kind}:${r.key}`">
          <span class="src-ref-kind">{{ r.kind }}</span> {{ r.name }}
        </li>
      </ul>
    </section>
  </article>
</template>

<script setup lang="ts">
/**
 * A Source has no page of its own, so this is how it is shown: in the
 * review preview only (the route's :slug carries the Source's id). Loads
 * itself, since no DetailPage drives it. What refers to a Source that is
 * being created is the bundle's edge list, under the preview.
 */
import { computed, inject, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSourceData } from '@/composables/useSourceData.ts'
import { SourceDataKey } from '@/composables/proposalDataInjection.ts'
import { blocksToHtml } from '@/utils/portableText.ts'

const props = defineProps<{ slug?: string }>()
const route = useRoute()

const { source, savedSections, referrers, loadSource } = inject(SourceDataKey, () => useSourceData(), true)

onMounted(() => { void loadSource(props.slug ?? String(route.params.slug)) })

const descriptionHtml = computed<string>(() => {
  const parts: string[] = []
  for (const s of savedSections.value) {
    if (!s.content) continue
    try {
      parts.push(blocksToHtml(JSON.parse(s.content) as unknown[]))
    } catch { /* skip */ }
  }
  return parts.join('')
})
</script>

<style scoped>
.src-preview { padding: var(--space-md); background: var(--paper); }

.src-head {
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--rule);
}
.src-kind {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
}
.src-title { margin: var(--space-xs) 0 0; font-size: var(--size-h3); overflow-wrap: anywhere; }
.src-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-lg);
  margin: var(--space-sm) 0 0;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
}
.src-meta div { display: flex; gap: var(--space-xs); }
.src-meta a { color: var(--ink); overflow-wrap: anywhere; }
.src-meta dt { color: var(--ink-soft); }
.src-meta dd { margin: 0; color: var(--ink); }

.src-section { margin: var(--space-lg) 0; }
.src-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  margin: 0 0 var(--space-sm);
}
.portable-text :deep(p) { margin: 0.5em 0 0.75em; line-height: 1.55; }
.src-referrers { list-style: none; margin: 0; padding: 0; font-family: var(--font-sans); font-size: var(--size-body-ui); }
.src-ref-kind {
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  margin-right: var(--space-xs);
}
</style>
