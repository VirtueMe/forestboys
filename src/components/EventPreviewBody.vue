<template>
  <article v-if="event" class="event-preview">
    <header class="event-head">
      <span class="event-kind">{{ event.kind === 'operation' ? 'Operasjon' : 'Hendelse' }}</span>
      <h2 class="event-name">{{ event.canonicalName }}</h2>
      <span v-if="event.date" class="event-date">{{ event.date }}</span>
    </header>

    <section v-if="descriptionHtml" class="event-section">
      <h3 class="event-section-heading">Beskrivelse</h3>
      <!-- eslint-disable vue/no-v-html -->
      <div class="portable-text" v-html="descriptionHtml"></div>
      <!-- eslint-enable vue/no-v-html -->
    </section>

    <section v-if="personEntries.length" class="event-section">
      <h3 class="event-section-heading">{{ event.kind === 'operation' ? 'Deltakere' : 'Involverte personer' }} ({{ personEntries.length }})</h3>
      <ul class="person-list">
        <li v-for="p in personEntries" :key="p.targetSlug" class="person-row">
          <span class="person-name">{{ p.targetName }}</span>
          <span v-if="p.role" class="person-role">{{ p.role }}</span>
        </li>
      </ul>
    </section>
  </article>
</template>

<script setup lang="ts">
/**
 * Slim Operation/Incident preview body. EntityPreviewPanel mounts this
 * for kind=Operation or kind=Incident. Reads from EventDataKey (or
 * spawns a live useEventData fallback) so a future EventDetail refactor
 * can swap to the same injection without changes here.
 */
import { computed, inject } from 'vue'
import { useEventData } from '@/composables/useEventData.ts'
import { EventDataKey } from '@/composables/proposalDataInjection.ts'
import { blocksToHtml } from '@/utils/portableText.ts'

const data = inject(EventDataKey, () => useEventData(), true)
const { event, savedSections, personEntries } = data

const descriptionHtml = computed<string>(() => {
  const parts: string[] = []
  for (const s of savedSections.value) {
    if (!s.content) continue
    try {
      const blocks = JSON.parse(s.content) as unknown[]
      parts.push(blocksToHtml(blocks as Parameters<typeof blocksToHtml>[0]))
    } catch { /* skip malformed */ }
  }
  return parts.join('')
})
</script>

<style scoped>
.event-preview {
  padding: var(--space-md);
  background: var(--paper);
}

.event-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--rule);
  flex-wrap: wrap;
}
.event-kind {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
}
.event-name { margin: 0; flex: 1; font-size: var(--size-h3); }
.event-date { color: var(--muted); font-family: var(--font-mono); font-size: 13px; }

.event-section { margin: var(--space-lg) 0; }
.event-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  margin: 0 0 var(--space-sm);
}

.portable-text :deep(p) { margin: 0.5em 0 0.75em; line-height: 1.55; }

.person-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.person-row { display: flex; gap: var(--space-md); }
.person-name { color: var(--ink); font-weight: 500; }
.person-role { color: var(--ink-soft); font-style: italic; }
</style>
