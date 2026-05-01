<template>
  <DetailPage
    :load="loadTransport"
    :reset="resetTransport"
    :not-found="!transport"
    not-found-text="Fremkomstmiddel ikke funnet."
    page-class="transport-detail"
  >
    <template v-if="transport">
      <TransportHeader
        :name="displayName"
        :type="displayType"
        :unit="displayUnit"
        :regser="displayRegser"
        :reserve="displayReserve"
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

      <TransportEditPane
        v-show="mode === 'edit'"
        ref="editPane"
        :slug="transportSlug"
        :transport="transport"
        :saved-sections="savedSections"
        :create-mode="isCreate"
        :pending-description="pendingDescription"
        @saved-scalar="onScalarSaved"
        @saved-sections="onSectionsSaved"
        @created="onCreated"
      />

      <TransportViewPane
        v-show="mode !== 'proposals'"
        :preview-sections="previewSections"
        :legacy-description="transport.description"
        :legacy-links-json="transport.links"
        :crew="crew"
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
import { useTransportData, type TransportNode } from '../composables/useTransportData.ts'
import { TransportDataKey } from '../composables/proposalDataInjection.ts'
import { useDetailCreateMode } from '../composables/useDetailCreateMode.ts'
import { useAuth } from '../composables/useAuth.ts'
import { useEntityBundles } from '../composables/useEntityBundles.ts'
import DetailPage from '../components/DetailPage.vue'
import AdminViewTabs from '../components/AdminViewTabs.vue'
import BundleReviewPanel from '../components/BundleReviewPanel.vue'
import type { Section } from '../components/SectionsEditor.vue'
import TransportHeader   from '../components/transport/TransportHeader.vue'
import TransportEditPane from '../components/transport/TransportEditPane.vue'
import TransportViewPane from '../components/transport/TransportViewPane.vue'
import type { TransportDraft } from '../components/transport/TransportScalarEditor.vue'

const { user } = useAuth()
const isAdminTransport = computed(() => user.value?.role === 'admin')

const { slug: transportSlug, isCreate, mode, pendingDescription, onCreated, clearPending } =
  useDetailCreateMode({ kind: 'transport', pathPrefix: '/transport' })

const bundlesPanel = useEntityBundles({
  kind:    'Transport',
  slug:    transportSlug,
  isAdmin: isAdminTransport,
})

function onSectionsSaved(sections: Section[]) {
  savedSections.value = sections
  clearPending()
}

const {
  transport, savedSections,
  crew, events, externalRefs, galleryImages,
  loadTransport, resetTransport,
} = inject(TransportDataKey, () => useTransportData(), true)

const editPane = useTemplateRef<{
  scalarDraft: TransportDraft | null
  scalarDirty: boolean
  descDraft:   Section[]
  descDirty:   boolean
} | null>('editPane')

function onScalarSaved(out: Partial<TransportNode>) {
  if (!transport.value) return
  if (out.name    !== undefined) transport.value.name    = out.name ?? ''
  if (out.type    !== undefined) transport.value.type    = out.type    ?? null
  if (out.unit    !== undefined) transport.value.unit    = out.unit    ?? null
  if (out.regser  !== undefined) transport.value.regser  = out.regser  ?? null
  if (out.reserve !== undefined) transport.value.reserve = out.reserve ?? null
}

function pick(field: keyof TransportDraft, fallback: string | null | undefined): string {
  const ed = editPane.value
  if (ed?.scalarDirty && ed.scalarDraft) return ed.scalarDraft[field]
  return fallback ?? ''
}
const displayName    = computed(() => pick('name',    transport.value?.name))
const displayType    = computed(() => pick('type',    transport.value?.type))
const displayUnit    = computed(() => pick('unit',    transport.value?.unit))
const displayRegser  = computed(() => pick('regser',  transport.value?.regser))
const displayReserve = computed(() => pick('reserve', transport.value?.reserve))

const previewSections = computed<Section[]>(() =>
  editPane.value?.descDirty ? editPane.value.descDraft : savedSections.value,
)
</script>
