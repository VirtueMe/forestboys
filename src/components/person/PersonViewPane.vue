<template>
  <!-- Single root so the page's v-show applies. -->
  <div class="view-pane">
    <section v-if="previewSections.length || person.descriptionHtml || person.description" class="section">
      <h3 class="section-heading">Beskrivelse</h3>
      <DescriptionPreview v-if="previewSections.length" :sections="previewSections" itemprop="description" />
      <LegacyDescription v-else :html="person.descriptionHtml" :text="person.description" itemprop="description" />
    </section>

    <PersonRelations
      mode="preview"
      :slug="person.slug"
      :data="relations"
    />

    <PersonExtraSections
      :person="person"
      :outlines="outlines"
      :show-legacy-events="showLegacyEvents"
    />

    <section v-if="galleryImages.length" class="section">
      <h3 class="section-heading">Galleri ({{ galleryImages.length }})</h3>
      <ImageSlider :images="galleryImages" />
    </section>

    <PersonExternalRefs :refs="externalRefs" />
  </div>
</template>

<script setup lang="ts">
/**
 * PersonViewPane — read-only preview body. The page renders identity
 * (back / hero / header / rank pills) + tabs above this; PersonViewPane
 * just owns Beskrivelse / Relations / Extras / Gallery / Refs.
 *
 * Rendered only when mode === 'preview' (PersonEditPane takes the slot
 * in edit mode).
 */
import ImageSlider         from '@/components/ImageSlider.vue'
import DescriptionPreview  from '@/components/DescriptionPreview.vue'
import LegacyDescription   from '@/components/LegacyDescription.vue'
import PersonRelations, { type PersonRelationsData } from './PersonRelations.vue'
import PersonExtraSections from './PersonExtraSections.vue'
import PersonExternalRefs, { type ExternalRef } from './PersonExternalRefs.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { SlideImage } from '@/components/ImageSlider.vue'

interface MergedPerson {
  slug:            string
  name:            string
  secretName:      string | null
  birthYear:       number | null
  home:            string | null
  type:            string | null
  descriptionHtml?: string | null
  description?:     string | null
  events?:    Array<{ slug: string; title: string; date?: string | null; organization?: string | null; district?: string | null }>
  locations?: { slug: string; title: string }[]
  stations?:  { slug: string; title: string }[]
  movie?:     string | null
}

defineProps<{
  person:           MergedPerson
  previewSections:  Section[]
  relations:        PersonRelationsData
  outlines:         { slug: string; title: string }[]
  showLegacyEvents: boolean
  galleryImages:    SlideImage[]
  externalRefs:     ExternalRef[]
}>()
</script>

