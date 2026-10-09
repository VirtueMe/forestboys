<template>
  <!-- Single root so the page's v-show applies. -->
  <div class="view-pane">
    <details v-if="!hideEditable && previewSections.length" class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Beskrivelse</h2>
      </summary>
      <div class="section-body">
        <DescriptionPreview :sections="previewSections" />
      </div>
    </details>
  
    <!-- Legacy ABOUT descriptions (sanity-outline-migration). Read-only
         until migrated to HAS_CONTENT — same treatment as Unit. -->
    <details v-if="legacyHtml.length" class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Beskrivelse (arkiv)</h2>
      </summary>
      <div class="section-body">
        <!-- eslint-disable vue/no-v-html -->
        <div v-for="(html, i) in legacyHtml" :key="i" class="portable-text description-entry" v-html="html"></div>
        <!-- eslint-enable vue/no-v-html -->
      </div>
    </details>

    <details v-if="!hideEditable && paired.length" class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Paret med</h2>
      </summary>
      <div class="section-body">
        <div class="link-list">
          <RouterLink
            v-for="p in paired"
            :key="p.targetSlug"
            :to="`/equipment/${p.targetSlug}`"
            class="section-link"
          >
            {{ p.targetName }}
          </RouterLink>
        </div>
      </div>
    </details>

    <details class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Lenker<span v-if="totalLinkCount"> ({{ totalLinkCount }})</span></h2>
      </summary>
      <div class="section-body">
        <div v-if="totalLinkCount" class="link-list">
          <a
            v-for="r in externalRefs"
            :key="r.id"
            :href="r.url"
            target="_blank"
            rel="noopener noreferrer"
            class="ref-item"
          >
            <span class="ref-title">{{ r.title ?? r.url }}</span>
            <span class="ref-meta">
              <span v-if="r.nbBacked" class="ref-nb" title="Nasjonalbiblioteket">NB</span>
              <span v-if="r.domain" class="ref-domain">{{ r.domain }}</span>
            </span>
          </a>
        </div>
        <p v-else class="section-empty">Ingen lenker registrert ennå.</p>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
/**
 * EquipmentViewPane — read-only sections for an EquipmentType page:
 * Beskrivelse, Beskrivelse (arkiv) (legacy ABOUT), Paret med, Lenker.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import DescriptionPreview from '@/components/DescriptionPreview.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry } from '@/components/relation/RelationStrategy.ts'
import type { EquipmentLegacyDescription, EquipmentExternalRef } from '@/composables/useEquipmentData.ts'
import { blocksToHtml } from '@/utils/portableText.ts'

const props = withDefaults(defineProps<{
  previewSections:    Section[]
  legacyDescriptions: EquipmentLegacyDescription[]
  paired:             RelationEntry[]
  externalRefs:       EquipmentExternalRef[]
  hideEditable?:      boolean
}>(), {
  hideEditable: false,
})

const legacyHtml = computed<string[]>(() =>
  props.legacyDescriptions.flatMap((d) => {
    if (!d.content) return []
    try {
      const html = blocksToHtml(JSON.parse(d.content) as Parameters<typeof blocksToHtml>[0])
      return html ? [html] : []
    } catch { return [] }
  }),
)

const totalLinkCount = computed(() => props.externalRefs.length)
</script>

<style scoped>
.section {
  border-bottom: 1px solid var(--rule);
  background: var(--paper-raised);
}
.section + .section { border-top: none; }
.section:last-of-type { margin-bottom: 48px; }

.section-summary {
  cursor: pointer;
  list-style: none;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.section-summary::-webkit-details-marker { display: none; }
.section-summary::after {
  content: '▾';
  font-size: 11px;
  color: var(--muted);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}
.section:not([open]) > .section-summary::after { transform: rotate(-90deg); }
.section-summary:hover { background: var(--paper); }

.section-body { padding: 0 16px 12px; }

.section-empty {
  margin: 0;
  padding: 4px 0;
  font-size: 12px;
  color: var(--muted);
  font-style: italic;
}
.section-heading {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
  margin: 0;
}

.link-list { display: flex; flex-direction: column; gap: 2px; }

.section-link {
  display: block;
  padding: 6px 8px;
  margin: 0 -8px;
  font-size: 13px;
  color: var(--focus);
  text-decoration: none;
  border-radius: 4px;
}
.section-link:hover { background: var(--paper); text-decoration: underline; }

.ref-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  margin: 0 -8px;
  text-decoration: none;
  color: var(--ink);
  border-radius: 4px;
  transition: background 0.1s;
}
.ref-item:hover { background: var(--paper); }
.ref-item:hover .ref-title { text-decoration: underline; }
.ref-title {
  font-size: 13px;
  color: var(--focus);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ref-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.ref-nb {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: var(--color-orange, #e38924);
  color: #fff;
}
.ref-domain { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }

.description-entry { margin: 0; }
.description-entry + .description-entry {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}

.portable-text { margin-top: 4px; }
</style>
