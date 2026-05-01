<template>
  <DetailPage
    :load="loadStation"
    :reset="resetStation"
    :not-found="!station"
    not-found-text="Stasjon ikke funnet."
    page-class="station-detail"
  >
    <template v-if="station">
      <StationHeader
        :name="displayName"
        :type="displayType"
        :active-from="displayActiveFrom"
        :active-to="displayActiveTo"
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

      <StationEditPane
        v-show="mode === 'edit'"
        ref="editPane"
        :slug="stationSlug"
        :station="station"
        :saved-sections="savedSections"
        :create-mode="isCreate"
        :pending-description="pendingDescription"
        @saved-scalar="onScalarSaved"
        @saved-sections="onSectionsSaved"
        @created="onCreated"
      />

      <StationViewPane
        v-show="mode !== 'proposals'"
        :preview-sections="previewSections"
        :legacy-description="station.description"
        :legacy-links-json="station.links"
        :people="people"
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
import { useStationData, type StationNode } from '../composables/useStationData.ts'
import { StationDataKey } from '../composables/proposalDataInjection.ts'
import { useDetailCreateMode } from '../composables/useDetailCreateMode.ts'
import { useAuth } from '../composables/useAuth.ts'
import { useEntityBundles } from '../composables/useEntityBundles.ts'
import DetailPage from '../components/DetailPage.vue'
import AdminViewTabs from '../components/AdminViewTabs.vue'
import BundleReviewPanel from '../components/BundleReviewPanel.vue'
import type { Section } from '../components/SectionsEditor.vue'
import StationHeader   from '../components/station/StationHeader.vue'
import StationEditPane from '../components/station/StationEditPane.vue'
import StationViewPane from '../components/station/StationViewPane.vue'
import type { StationDraft } from '../components/station/StationScalarEditor.vue'

const { user } = useAuth()
const isAdminStation = computed(() => user.value?.role === 'admin')

const { slug: stationSlug, isCreate, mode, pendingDescription, onCreated, clearPending } =
  useDetailCreateMode({ kind: 'station', pathPrefix: '/station' })

const bundlesPanel = useEntityBundles({
  kind:    'Station',
  slug:    stationSlug,
  isAdmin: isAdminStation,
})

function onSectionsSaved(sections: Section[]) {
  savedSections.value = sections
  clearPending()
}

const {
  station, savedSections,
  people, events, externalRefs, galleryImages,
  loadStation, resetStation,
} = inject(StationDataKey, () => useStationData(), true)

const editPane = useTemplateRef<{
  scalarDraft: StationDraft | null
  scalarDirty: boolean
  descDraft:   Section[]
  descDirty:   boolean
} | null>('editPane')

function onScalarSaved(out: Partial<StationNode>) {
  if (!station.value) return
  if (out.name       !== undefined) station.value.name       = out.name ?? ''
  if (out.type       !== undefined) station.value.type       = out.type       ?? null
  if (out.lat        !== undefined) station.value.lat        = out.lat        ?? null
  if (out.lng        !== undefined) station.value.lng        = out.lng        ?? null
  if (out.activeFrom !== undefined) station.value.activeFrom = out.activeFrom ?? null
  if (out.activeTo   !== undefined) station.value.activeTo   = out.activeTo   ?? null
}

function pickStr(field: keyof StationDraft, fallback: string | null | undefined): string {
  const ed = editPane.value
  if (ed?.scalarDirty && ed.scalarDraft) return ed.scalarDraft[field]
  return fallback ?? ''
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

const displayName       = computed(() => pickStr('name',       station.value?.name))
const displayType       = computed(() => pickStr('type',       station.value?.type))
const displayActiveFrom = computed(() => pickStr('activeFrom', station.value?.activeFrom))
const displayActiveTo   = computed(() => pickStr('activeTo',   station.value?.activeTo))
const displayLat        = computed(() => pickCoord('lat', station.value?.lat))
const displayLng        = computed(() => pickCoord('lng', station.value?.lng))

const previewSections = computed<Section[]>(() =>
  editPane.value?.descDirty ? editPane.value.descDraft : savedSections.value,
)
</script>
