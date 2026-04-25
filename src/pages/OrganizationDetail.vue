<template>
  <DetailPage
    :load="loadOrg"
    :reset="resetOrg"
    :not-found="!org"
    not-found-text="Organisasjon ikke funnet."
    page-class="org-detail"
  >
    <template v-if="org">
      <OrganizationHeader
        :name="displayName"
        :abbreviation="displayAbbreviation"
        :formal-name="displayFormalName"
        :color="displayColor"
        :founded-date="displayFoundedDate"
        :dissolved-date="displayDissolvedDate"
        :country="displayCountry"
      />

      <AdminViewTabs v-model="mode" />

      <OrganizationEditPane
        v-show="mode === 'edit'"
        ref="editPane"
        :slug="orgSlug"
        :org="org"
        :saved-sections="savedSections"
        :unit-entries="unitEntries"
        :unit-targets="unitTargets"
        :operation-entries="operationEntries"
        :operation-targets="operationTargets"
        :incident-entries="incidentEntries"
        :incident-targets="incidentTargets"
        :create-mode="isCreate"
        :pending-description="pendingDescription"
        :create-event-href="createEventHref"
        @saved-scalar="onScalarSaved"
        @saved-sections="onSectionsSaved"
        @created="onCreated"
      />

      <!-- Always-visible read-only sections. The editable ones
           (Beskrivelse, Underavdelinger, Operasjoner, Hendelser) hide in
           edit mode; the rest (Galleri, Deltakere, Lenker) stay visible.
           In create mode the data refs are mostly empty so most sections
           naturally collapse via their own v-if; the header + Beskrivelse
           preview reflect the in-progress draft via the editor overlays. -->
      <OrganizationViewPane
        :preview-sections="previewSections"
        :unit-entries="unitEntries"
        :operation-entries="operationEntries"
        :incident-entries="incidentEntries"
        :gallery-images="galleryImages"
        :people="people"
        :external-refs="externalRefs"
        :hide-editable="mode === 'edit'"
      />
    </template>
  </DetailPage>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { useOrganizationData, type OrgNode } from '../composables/useOrganizationData.ts'
import { useDetailCreateMode } from '../composables/useDetailCreateMode.ts'
import DetailPage from '../components/DetailPage.vue'
import AdminViewTabs from '../components/AdminViewTabs.vue'
import type { Section } from '../components/SectionsEditor.vue'
import OrganizationHeader   from '../components/organization/OrganizationHeader.vue'
import OrganizationEditPane from '../components/organization/OrganizationEditPane.vue'
import OrganizationViewPane from '../components/organization/OrganizationViewPane.vue'
import type { OrgDraft }    from '../components/organization/OrganizationScalarEditor.vue'

const { slug: orgSlug, isCreate, mode, pendingDescription, onCreated, clearPending } =
  useDetailCreateMode({ kind: 'organization', pathPrefix: '/organization' })

function onSectionsSaved(sections: Section[]) {
  savedSections.value = sections
  clearPending()
}

// Neo4j data layer.
const {
  org, savedSections,
  unitEntries,      unitTargets,
  operationEntries, operationTargets,
  incidentEntries,  incidentTargets,
  people,
  externalRefs, galleryImages,
  loadOrg, resetOrg,
} = useOrganizationData()

function createEventHref(kind: 'incident' | 'operation'): string {
  const slug = orgSlug.value
  const q = new URLSearchParams({ kind, forOrg: slug, returnTo: `/organization/${slug}` })
  return `/events/new?${q.toString()}#new`
}

// EditPane exposes scalar + description drafts; we read them so the header
// + Beskrivelse preview overlay the unsaved values while editing.
const editPane = useTemplateRef<{
  scalarDraft: OrgDraft | null
  scalarDirty: boolean
  descDraft:   Section[]
  descDirty:   boolean
} | null>('editPane')

function onScalarSaved(out: Partial<OrgNode>) {
  if (!org.value) return
  if (out.name           !== undefined) org.value.name          = out.name ?? ''
  if (out.formalName     !== undefined) org.value.formalName    = out.formalName    ?? null
  if (out.abbreviation   !== undefined) org.value.abbreviation  = out.abbreviation  ?? null
  if (out.sortingName    !== undefined) org.value.sortingName   = out.sortingName   ?? null
  if (out.color          !== undefined) org.value.color         = out.color         ?? null
  if (out.country        !== undefined) org.value.country       = out.country       ?? null
  if (out.foundedDate    !== undefined) org.value.foundedDate   = out.foundedDate   ?? null
  if (out.dissolvedDate  !== undefined) org.value.dissolvedDate = out.dissolvedDate ?? null
}

/** Header overlay: prefer the editor's draft when dirty. */
function pick(field: keyof OrgDraft, fallback: string | null | undefined): string {
  const ed = editPane.value
  if (ed?.scalarDirty && ed.scalarDraft) return ed.scalarDraft[field]
  return fallback ?? ''
}
const displayName          = computed(() => pick('name',          org.value?.name))
const displayFormalName    = computed(() => pick('formalName',    org.value?.formalName))
const displayAbbreviation  = computed(() => pick('abbreviation',  org.value?.abbreviation))
const displayColor         = computed(() => pick('color',         org.value?.color))
const displayCountry       = computed(() => pick('country',       org.value?.country))
const displayFoundedDate   = computed(() => pick('foundedDate',   org.value?.foundedDate))
const displayDissolvedDate = computed(() => pick('dissolvedDate', org.value?.dissolvedDate))

/** Beskrivelse preview overlays the description editor's unsaved draft. */
const previewSections = computed<Section[]>(() =>
  editPane.value?.descDirty ? editPane.value.descDraft : savedSections.value,
)
</script>
