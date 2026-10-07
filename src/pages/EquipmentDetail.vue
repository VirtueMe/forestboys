<template>
  <DetailPage
    :load="loadEquipment"
    :reset="resetEquipment"
    :not-found="!equipment"
    not-found-text="Utstyr ikke funnet."
    page-class="equipment-detail"
  >
    <template v-if="equipment">
      <EquipmentHeader
        :name="displayName"
        :type="pick('type', equipment.type)"
        :subtype="pick('subtype', equipment.subtype)"
        :country="pick('country', equipment.country)"
        :period="pick('period', equipment.period)"
      />

      <!-- No Forslag tab: there is no per-entity proposal list for
           EquipmentType. Bundles preview it through EquipmentDataKey. -->
      <AdminViewTabs v-model="mode" />

      <EquipmentEditPane
        v-if="isAdmin"
        v-show="mode === 'edit'"
        ref="editPane"
        :slug="equipmentSlug"
        :equipment="equipment"
        :paired="paired"
        :saved-sections="savedSections"
        :create-mode="isCreate"
        :pending-description="pendingDescription"
        @saved-scalar="onScalarSaved"
        @saved-sections="onSectionsSaved"
        @created="onCreated"
      />

      <EquipmentViewPane
        v-show="mode !== 'proposals'"
        :preview-sections="previewSections"
        :legacy-descriptions="legacyDescriptions"
        :paired="paired.entries"
        :external-refs="externalRefs"
        :hide-editable="mode === 'edit'"
      />
    </template>
  </DetailPage>
</template>

<script setup lang="ts">
import { computed, inject, useTemplateRef } from 'vue'
import { useEquipmentData, type EquipmentNode } from '../composables/useEquipmentData.ts'
import { EquipmentDataKey } from '../composables/proposalDataInjection.ts'
import { useDetailCreateMode } from '../composables/useDetailCreateMode.ts'
import { useAuth } from '../composables/useAuth.ts'
import DetailPage from '../components/DetailPage.vue'
import AdminViewTabs from '../components/AdminViewTabs.vue'
import type { Section } from '../components/SectionsEditor.vue'
import EquipmentHeader   from '../components/equipment/EquipmentHeader.vue'
import EquipmentEditPane from '../components/equipment/EquipmentEditPane.vue'
import EquipmentViewPane from '../components/equipment/EquipmentViewPane.vue'
import type { EquipmentDraft } from '../components/equipment/EquipmentScalarEditor.vue'

const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

const { slug: equipmentSlug, isCreate, mode, pendingDescription, onCreated, clearPending } =
  useDetailCreateMode({ kind: 'equipment', pathPrefix: '/equipment' })

const {
  equipment, savedSections, legacyDescriptions, externalRefs, paired,
  loadEquipment, resetEquipment,
} = inject(EquipmentDataKey, () => useEquipmentData(), true)

function onSectionsSaved(sections: Section[]) {
  savedSections.value = sections
  clearPending()
}

const editPane = useTemplateRef<{
  scalarDraft: EquipmentDraft | null
  scalarDirty: boolean
  descDraft:   Section[]
  descDirty:   boolean
} | null>('editPane')

function onScalarSaved(out: Partial<EquipmentNode>) {
  if (!equipment.value) return
  if (out.canonicalName !== undefined) equipment.value.canonicalName = out.canonicalName ?? ''
  for (const k of ['type', 'subtype', 'country', 'period'] as const) {
    if (out[k] !== undefined) equipment.value[k] = out[k] ?? null
  }
}

/** Header shows the in-progress draft while the scalar editor is dirty. */
function pick(field: 'type' | 'subtype' | 'country' | 'period', saved: string | null): string | null {
  const ed = editPane.value
  if (ed?.scalarDirty && ed.scalarDraft) return ed.scalarDraft[field].trim() || null
  return saved
}

const displayName = computed(() => {
  const ed = editPane.value
  if (ed?.scalarDirty && ed.scalarDraft) return ed.scalarDraft.name
  return equipment.value?.canonicalName ?? ''
})

const previewSections = computed<Section[]>(() =>
  editPane.value?.descDirty ? editPane.value.descDraft : savedSections.value,
)
</script>
