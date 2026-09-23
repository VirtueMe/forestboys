<template>
  <!-- Single root so the page's v-show applies. -->
  <div class="view-pane">
    <details v-if="!hideEditable && previewSections.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Beskrivelse</h3>
      </summary>
      <div class="section-body">
        <DescriptionPreview :sections="previewSections" />
      </div>
    </details>

    <details v-if="!hideEditable && unitEntries.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Underavdelinger ({{ unitEntries.length }})</h3>
      </summary>
      <div class="section-body">
        <div class="relation-list">
          <div v-for="u in unitEntries" :key="u.targetSlug" class="relation-row">
            <RouterLink :to="`/district/${u.targetSlug}`" class="relation-link">{{ u.targetName }}</RouterLink>
            <span v-if="u.role" class="relation-role">{{ PART_OF_ROLE_LABEL[u.role] ?? u.role }}</span>
            <button
              v-if="u.hasDescription"
              class="info-marker"
              type="button"
              aria-label="Vis forklaring"
              @click="activeUnit = u"
            >
              i
            </button>
          </div>
        </div>
      </div>
    </details>

    <RelationInfoPopup
      :entry="activeUnit"
      :role-options="PART_OF_ROLE_LABEL"
      show-role
      @close="activeUnit = null"
    />

    <details v-if="!hideEditable && operationEntries.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Operasjoner ({{ operationEntries.length }})</h3>
      </summary>
      <div class="section-body">
        <div class="relation-list">
          <div v-for="op in operationEntries" :key="op.targetSlug" class="relation-row">
            <RouterLink :to="`/events/${op.targetSlug}`" class="relation-link">{{ op.targetName }}</RouterLink>
            <span v-if="op.startDate" class="relation-date">{{ op.startDate }}</span>
          </div>
        </div>
      </div>
    </details>

    <details v-if="!hideEditable && incidentEntries.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Hendelser ({{ incidentEntries.length }})</h3>
      </summary>
      <div class="section-body">
        <div class="relation-list">
          <div v-for="ev in incidentEntries" :key="ev.targetSlug" class="relation-row">
            <RouterLink :to="`/events/${ev.targetSlug}`" class="relation-link">{{ ev.targetName }}</RouterLink>
            <span v-if="ev.startDate" class="relation-date">{{ ev.startDate }}</span>
          </div>
        </div>
      </div>
    </details>

    <details v-if="galleryImages.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Galleri ({{ galleryImages.length }})</h3>
      </summary>
      <div class="section-body">
        <ImageSlider :images="galleryImages" />
      </div>
    </details>

    <details v-if="people.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Deltakere ({{ people.length }})</h3>
      </summary>
      <div class="section-body">
        <div class="link-list">
          <RouterLink
            v-for="p in people"
            :key="p.slug"
            :to="`/person/${p.slug}`"
            class="person-item"
          >
            <span class="person-name">{{ p.name }}</span>
            <span class="person-count">{{ p.eventCount }} hendelser</span>
          </RouterLink>
        </div>
      </div>
    </details>

    <details class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Lenker<span v-if="externalRefs.length"> ({{ externalRefs.length }})</span></h3>
      </summary>
      <div class="section-body">
        <div v-if="externalRefs.length" class="link-list">
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
 * OrganizationViewPane — read-only body sections of an Organization
 * page. Sits below the View / Edit tabs in preview mode (the page
 * mounts EditPane in edit mode instead).
 *
 * Sections are rendered as collapsible <details class="section">
 * blocks (Org's local convention; section padding lives on the inner
 * summary + body so the global section.section rule doesn't apply).
 */
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import ImageSlider, { type SlideImage } from '@/components/ImageSlider.vue'
import DescriptionPreview from '@/components/DescriptionPreview.vue'
import RelationInfoPopup from '@/components/relation/RelationInfoPopup.vue'
import { PART_OF_ROLE_LABEL } from '@/components/relation/strategies.ts'
import type { RelationEntry } from '@/components/relation/RelationStrategy.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { ExternalRef } from '@/components/person/PersonExternalRefs.vue'
import type { DeltakerLink } from '@/composables/useOrganizationData.ts'

withDefaults(defineProps<{
  previewSections:  Section[]
  unitEntries:      RelationEntry[]
  operationEntries: RelationEntry[]
  incidentEntries:  RelationEntry[]
  galleryImages:    SlideImage[]
  people:           DeltakerLink[]
  externalRefs:     ExternalRef[]
  /** Hide every section that has an editor on this page (Beskrivelse,
   *  Underavdelinger, Operasjoner, Hendelser) so they don't double up
   *  below the EditPane in edit mode. The non-editable sections (Galleri,
   *  Deltakere, Lenker) keep rendering. */
  hideEditable?:    boolean
}>(), {
  hideEditable: false,
})

const activeUnit = ref<RelationEntry | null>(null)
</script>

<style scoped>
/* Org sections are collapsibles — padding lives on summary + body, not
   the wrapping <details>. Distinct from the global section.section rule
   which targets <section.section> only. */
.section {
  border-bottom: 1px solid var(--rule);
  background: var(--paper-raised);
}
.section + .section { border-top: none; }
.section:last-of-type { margin-bottom: var(--space-xl); }

.section-summary {
  cursor: pointer;
  list-style: none;
  padding: var(--space-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.section-summary::-webkit-details-marker { display: none; }
.section-summary::after {
  content: '▾';
  font-size: var(--size-label);
  color: var(--muted);
  transition: transform 150ms ease;
  flex-shrink: 0;
}
.section:not([open]) > .section-summary::after { transform: rotate(-90deg); }
.section-summary:hover { background: var(--paper-sunken); }

.section-body { padding: 0 var(--space-md) var(--space-md); }

.section-empty {
  margin: 0;
  padding: var(--space-xs) 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  font-style: italic;
}


.link-list { display: flex; flex-direction: column; gap: var(--space-xs); }

.section-link {
  display: block;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  padding: var(--space-xs) 0;
}
.section-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

/* Underavdelinger / Operasjoner / Hendelser inline list */
.relation-list { display: flex; flex-direction: column; gap: var(--space-xs); }
.relation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
}
.relation-link {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
}
.relation-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

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

.relation-date {
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.info-marker {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--rule);
  background: var(--paper);
  color: var(--ink-soft);
  font-family: var(--font-serif);
  font-size: var(--size-label);
  font-weight: 600;
  font-style: italic;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.info-marker:hover {
  background: var(--faded-red);
  border-color: var(--faded-red);
  color: var(--paper);
}

/* Deltakere items */
.person-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0 calc(var(--space-sm) * -1);
  text-decoration: none;
  border-radius: var(--radius-md);
  transition: background 120ms ease-out;
}
.person-item:hover { background: var(--paper-sunken); }
.person-item:hover .person-name { color: var(--faded-red); }
.person-name {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
}
.person-count {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  white-space: nowrap;
  flex-shrink: 0;
}

/* Lenker */
.ref-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0 calc(var(--space-sm) * -1);
  text-decoration: none;
  color: var(--ink);
  border-radius: var(--radius-md);
  transition: background 120ms ease-out;
}
.ref-item:hover { background: var(--paper-sunken); }
.ref-item:hover .ref-title { color: var(--faded-red); }
.ref-title {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ref-meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}
.ref-nb {
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  background: var(--moss);
  color: var(--paper);
}
.ref-domain {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
