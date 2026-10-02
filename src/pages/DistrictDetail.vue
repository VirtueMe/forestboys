<template>
  <DetailPage
    :load="loadUnit"
    :reset="resetUnit"
    :not-found="!unit"
    not-found-text="Avdeling ikke funnet."
    page-class="district-detail"
  >
    <template v-if="unit">
      <UnitHeader
        :name="displayName"
        :formal-name="displayFormalName"
        :founded-date="displayFoundedDate"
        :dissolved-date="displayDissolvedDate"
        :country="displayCountry"
        :parents="parents"
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

      <UnitEditPane
        v-show="mode === 'edit'"
        ref="editPane"
        :slug="unitSlug"
        :unit="unit"
        :saved-sections="savedSections"
        :person-entries="personEntries"
        :person-targets="personTargets"
        :create-mode="isCreate"
        :pending-description="pendingDescription"
        @saved-scalar="onScalarSaved"
        @saved-sections="onSectionsSaved"
        @created="onCreated"
      />

      <UnitViewPane
        v-show="mode !== 'proposals'"
        :preview-sections="previewSections"
        :legacy-descriptions="legacyDescriptions"
        :sub-units="subUnits"
        :courses="courses"
        :members="members"
        :events="events"
        :external-refs="externalRefs"
        :gallery-images="galleryImages"
        :hide-editable="mode === 'edit'"
      />
    </template>
  </DetailPage>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch, inject } from 'vue'
import { useUnitData, type UnitNode } from '../composables/useUnitData.ts'
import { UnitDataKey } from '../composables/proposalDataInjection.ts'
import { useAuth } from '../composables/useAuth.ts'
import { useEntityBundles } from '../composables/useEntityBundles.ts'
import BundleReviewPanel from '../components/BundleReviewPanel.vue'
import { useDetailCreateMode } from '../composables/useDetailCreateMode.ts'
import DetailPage from '../components/DetailPage.vue'
import AdminViewTabs from '../components/AdminViewTabs.vue'
import type { Section } from '../components/SectionsEditor.vue'
import UnitHeader      from '../components/district/UnitHeader.vue'
import UnitEditPane    from '../components/district/UnitEditPane.vue'
import UnitViewPane    from '../components/district/UnitViewPane.vue'
import type { UnitDraft } from '../components/district/UnitScalarEditor.vue'
import { UnitMembersStrategy, UnitAttendeesStrategy } from '../components/relation/strategies.ts'
import type { RelationEntry, RelationTarget } from '../components/relation/RelationStrategy.ts'

const { slug: unitSlug, isCreate, mode, pendingDescription, onCreated, clearPending } =
  useDetailCreateMode({ kind: 'unit', pathPrefix: '/district' })

const { user } = useAuth()
const isAdminUnit = computed(() => user.value?.role === 'admin')
const bundlesPanel = useEntityBundles({
  kind:    'Unit',
  slug:    unitSlug,
  isAdmin: isAdminUnit,
})
bundlesPanel.focusOnHash(mode)

function onSectionsSaved(sections: Section[]) {
  savedSections.value = sections
  clearPending()
}

const {
  unit, savedSections, legacyDescriptions,
  parents, subUnits, courses, members, events,
  externalRefs, galleryImages,
  loadUnit, resetUnit,
} = inject(UnitDataKey, () => useUnitData(), true)

// Members editor uses a strategy that depends on whether the Unit is a
// training course (Deltakere) or a regular unit (Medlemmer). The
// composable doesn't know which, so the page loads it after `unit` is
// hydrated.
const personEntries  = ref<RelationEntry[]>([])
const personTargets  = ref<RelationTarget[]>([])
const personStrategy = computed(() => (unit.value?.type === 'course' ? UnitAttendeesStrategy : UnitMembersStrategy))

watch([unitSlug, () => unit.value?.type], async ([slug]) => {
  if (!slug || slug === 'new' || !unit.value) {
    personEntries.value = []; personTargets.value = []; return
  }
  try {
    const [entries, targets] = await Promise.all([
      personStrategy.value.fetchEntries(slug),
      personStrategy.value.fetchTargets(),
    ])
    personEntries.value = entries
    personTargets.value = targets
  } catch {
    personEntries.value = []; personTargets.value = []
  }
})

// EditPane exposes scalar + description drafts so the header + Beskrivelse
// preview overlay the unsaved values while editing.
const editPane = useTemplateRef<{
  scalarDraft: UnitDraft | null
  scalarDirty: boolean
  descDraft:   Section[]
  descDirty:   boolean
} | null>('editPane')

function onScalarSaved(out: Partial<UnitNode>) {
  if (!unit.value) return
  if (out.name          !== undefined) unit.value.name          = out.name ?? ''
  if (out.formalName    !== undefined) unit.value.formalName    = out.formalName    ?? null
  if (out.color         !== undefined) unit.value.color         = out.color         ?? null
  if (out.country       !== undefined) unit.value.country       = out.country       ?? null
  if (out.foundedDate   !== undefined) unit.value.foundedDate   = out.foundedDate   ?? null
  if (out.dissolvedDate !== undefined) unit.value.dissolvedDate = out.dissolvedDate ?? null
}

function pick(field: keyof UnitDraft, fallback: string | null | undefined): string {
  const ed = editPane.value
  if (ed?.scalarDirty && ed.scalarDraft) return ed.scalarDraft[field]
  return fallback ?? ''
}
const displayName          = computed(() => pick('name',          unit.value?.name))
const displayFormalName    = computed(() => pick('formalName',    unit.value?.formalName))
const displayCountry       = computed(() => pick('country',       unit.value?.country))
const displayFoundedDate   = computed(() => pick('foundedDate',   unit.value?.foundedDate))
const displayDissolvedDate = computed(() => pick('dissolvedDate', unit.value?.dissolvedDate))

const previewSections = computed<Section[]>(() =>
  editPane.value?.descDirty ? editPane.value.descDraft : savedSections.value,
)
</script>
