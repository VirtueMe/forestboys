<template>
  <article v-if="article" class="art-preview">
    <header class="art-head">
      <span class="art-kind">Artikkel</span>
      <h1 class="art-title">{{ article.title }}</h1>
      <dl v-if="article.author || article.topic" class="art-meta">
        <div v-if="article.author"><dt>Forfatter</dt><dd>{{ article.author }}</dd></div>
        <div v-if="article.topic"><dt>Tema</dt><dd>{{ article.topic }}</dd></div>
      </dl>
    </header>

    <section v-if="descriptionHtml" class="art-section">
      <h2 class="art-section-heading">Beskrivelse</h2>
      <!-- eslint-disable vue/no-v-html -->
      <div class="portable-text" v-html="descriptionHtml"></div>
      <!-- eslint-enable vue/no-v-html -->
    </section>
  </article>
</template>

<script setup lang="ts">
/**
 * An Article has no page of its own, so this is how it is shown: in the
 * review preview only. Loads itself, since no DetailPage drives it.
 */
import { computed, inject, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useArticleData } from '@/composables/useArticleData.ts'
import { ArticleDataKey } from '@/composables/proposalDataInjection.ts'
import { blocksToHtml } from '@/utils/portableText.ts'

const props = defineProps<{ slug?: string }>()
const route = useRoute()

const { article, savedSections, loadArticle } = inject(ArticleDataKey, () => useArticleData(), true)

onMounted(() => { void loadArticle(props.slug ?? String(route.params.slug)) })

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
.art-preview { padding: var(--space-md); background: var(--paper); }

.art-head {
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--rule);
}
.art-kind {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
}
.art-title { margin: var(--space-xs) 0 0; font-size: var(--size-h3); }
.art-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-lg);
  margin: var(--space-sm) 0 0;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
}
.art-meta div { display: flex; gap: var(--space-xs); }
.art-meta dt { color: var(--ink-soft); }
.art-meta dd { margin: 0; color: var(--ink); }

.art-section { margin: var(--space-lg) 0; }
.art-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  margin: 0 0 var(--space-sm);
}
.portable-text :deep(p) { margin: 0.5em 0 0.75em; line-height: 1.55; }
</style>
