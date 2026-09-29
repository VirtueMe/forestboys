<template>
  <header class="source-popover-header">
    <span v-if="source?.type" class="source-popover-type">{{ typeLabel(source.type) }}</span>
    <button class="source-popover-close" type="button" aria-label="Lukk" @click="emit('close')">×</button>
  </header>
  <p class="source-popover-title">{{ title }}</p>
  <p v-if="fragmentLabel" class="source-popover-meta">Referanse: {{ fragmentLabel }}</p>
  <p v-if="source?.domain" class="source-popover-meta">{{ source.domain }}</p>
  <a
    v-if="source?.url"
    :href="source.url"
    target="_blank"
    rel="noopener noreferrer"
    class="source-popover-link"
  >Åpne kilde ↗</a>
  <p v-else-if="!source" class="source-popover-meta source-popover-missing">
    Kilden finnes ikke i grafen ennå ({{ id }}).
  </p>
</template>

<script setup lang="ts">
/**
 * SourceRefDetails — the body of one SourceRef's details: type, title,
 * reference (page), domain and a link. SourceRef places it either as a
 * floating popover by the chip, or in the flow under the chips (`inline`).
 */
import type { ResolvedSource } from '@/composables/useSourceRefs.ts'

defineProps<{
  id:            string
  title:         string
  fragmentLabel: string | null
  source:        ResolvedSource | null
}>()

const emit = defineEmits<{ close: [] }>()

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
</script>

<style scoped>
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
  margin-left: auto;
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
