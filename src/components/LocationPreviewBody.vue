<template>
  <article v-if="location" class="loc-preview">
    <header class="loc-head">
      <span class="loc-kind">Sted</span>
      <h2 class="loc-name">{{ location.canonicalName }}</h2>
      <span v-if="location.lat != null && location.lng != null" class="loc-coords">
        {{ location.lat.toFixed(4) }}, {{ location.lng.toFixed(4) }}
      </span>
    </header>

    <section v-if="descriptionHtml" class="loc-section">
      <h3 class="loc-section-heading">Beskrivelse</h3>
      <!-- eslint-disable vue/no-v-html -->
      <div class="portable-text" v-html="descriptionHtml"></div>
      <!-- eslint-enable vue/no-v-html -->
    </section>
  </article>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { useLocationData } from '@/composables/useLocationData.ts'
import { LocationDataKey } from '@/composables/proposalDataInjection.ts'
import { blocksToHtml } from '@/utils/portableText.ts'

const { location, savedSections } = inject(LocationDataKey, () => useLocationData(), true)

const descriptionHtml = computed<string>(() => {
  const parts: string[] = []
  for (const s of savedSections.value) {
    if (!s.content) continue
    try {
      const blocks = JSON.parse(s.content) as unknown[]
      parts.push(blocksToHtml(blocks as Parameters<typeof blocksToHtml>[0]))
    } catch { /* skip */ }
  }
  return parts.join('')
})
</script>

<style scoped>
.loc-preview { padding: var(--space-md); background: var(--paper); }

.loc-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--rule);
  flex-wrap: wrap;
}
.loc-kind {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
}
.loc-name { margin: 0; flex: 1; font-size: var(--size-h3); }
.loc-coords { color: var(--muted); font-family: var(--font-mono); font-size: 13px; }

.loc-section { margin: var(--space-lg) 0; }
.loc-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  margin: 0 0 var(--space-sm);
}
.portable-text :deep(p) { margin: 0.5em 0 0.75em; line-height: 1.55; }
</style>
