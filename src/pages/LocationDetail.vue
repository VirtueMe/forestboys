<template>
  <DetailPage
    :load="loadLocation"
    :reset="resetLocation"
    :not-found="!location"
    not-found-text="Sted ikke funnet."
    page-class="location-detail"
  >
    <template v-if="location">
      <LocationHeader
        :name="displayName"
        :slug="isCreate ? undefined : locationSlug"
        :lat="displayLat"
        :lng="displayLng"
      />

      <AdminViewTabs v-model="mode" :proposal-count="bundlesPanel.openBundles.value.length" />

      <template v-if="mode === 'proposals' && bundlesPanel.currentBundle.value">
        <BundleReviewPanel
          :key="bundlesPanel.currentBundle.value.bundleId"
          :bundle-id="bundlesPanel.currentBundle.value.bundleId"
          :older-bundle="bundlesPanel.olderBundle.value"
          :newer-bundle="bundlesPanel.newerBundle.value"
          @deleted="bundlesPanel.onBundleDeleted"
          @navigate="bundlesPanel.onBundleNavigate"
        />
      </template>

      <LocationEditPane
        v-if="isAdmin"
        v-show="mode === 'edit'"
        ref="editPane"
        :slug="locationSlug"
        :location="location"
        :saved-sections="savedSections"
        :create-mode="isCreate"
        :pending-description="pendingDescription"
        @saved-scalar="onScalarSaved"
        @saved-sections="onSectionsSaved"
        @created="onCreated"
      />

      <LocationViewPane
        v-show="mode !== 'proposals'"
        :lat="displayLat"
        :lng="displayLng"
        :slug="isCreate ? undefined : locationSlug"
        :preview-sections="previewSections"
        :events="events"
        :external-refs="externalRefs"
        :gallery-images="galleryImages"
        :hide-editable="mode === 'edit'"
      />
    </template>
  </DetailPage>
</template>

<script setup lang="ts">
import { computed, useTemplateRef, inject } from 'vue'
import { useLocationData, type LocationNode } from '../composables/useLocationData.ts'
import { LocationDataKey } from '../composables/proposalDataInjection.ts'
import { useDetailCreateMode } from '../composables/useDetailCreateMode.ts'
import { useAuth } from '../composables/useAuth.ts'
import { useEntityBundles } from '../composables/useEntityBundles.ts'
import DetailPage from '../components/DetailPage.vue'
import AdminViewTabs from '../components/AdminViewTabs.vue'
import BundleReviewPanel from '../components/BundleReviewPanel.vue'
import type { Section } from '../components/SectionsEditor.vue'
import LocationHeader   from '../components/location/LocationHeader.vue'
import LocationEditPane from '../components/location/LocationEditPane.vue'
import LocationViewPane from '../components/location/LocationViewPane.vue'
import type { LocationDraft } from '../components/location/LocationScalarEditor.vue'

const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

const { slug: locationSlug, isCreate, mode, pendingDescription, onCreated, clearPending } =
  useDetailCreateMode({ kind: 'location', pathPrefix: '/location' })

const bundlesPanel = useEntityBundles({
  kind:    'Location',
  slug:    locationSlug,
  isAdmin,
})

function onSectionsSaved(sections: Section[]) {
  savedSections.value = sections
  clearPending()
}

const {
  location, savedSections,
  events, externalRefs, galleryImages,
  loadLocation, resetLocation,
} = inject(LocationDataKey, () => useLocationData(), true)

const editPane = useTemplateRef<{
  scalarDraft: LocationDraft | null
  scalarDirty: boolean
  descDraft:   Section[]
  descDirty:   boolean
} | null>('editPane')

function onScalarSaved(out: Partial<LocationNode>) {
  if (!location.value) return
  if (out.canonicalName !== undefined) location.value.canonicalName = out.canonicalName ?? ''
  if (out.lat           !== undefined) location.value.lat           = out.lat ?? null
  if (out.lng           !== undefined) location.value.lng           = out.lng ?? null
}

function pickCoord(field: 'lat' | 'lng', fallback: number | null | undefined): number | null {
  const ed = editPane.value
  if (ed?.scalarDirty && ed.scalarDraft) {
    const t = ed.scalarDraft[field].trim()
    if (!t) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return fallback ?? null
}

const displayName = computed(() => {
  const ed = editPane.value
  if (ed?.scalarDirty && ed.scalarDraft) return ed.scalarDraft.name
  return location.value?.canonicalName ?? ''
})
const displayLat = computed(() => pickCoord('lat', location.value?.lat))
const displayLng = computed(() => pickCoord('lng', location.value?.lng))

const previewSections = computed<Section[]>(() =>
  editPane.value?.descDirty ? editPane.value.descDraft : savedSections.value,
)
</script>
