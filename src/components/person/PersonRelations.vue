<template>
  <!-- Edit mode: all four relation editors -->
  <template v-if="mode === 'edit'">
    <RelationListEditor
      :parent-slug="slug"
      :entries="data.membership.entries"
      :targets="data.membership.targets"
      :strategy="MembershipStrategy"
      label="Medlemskap"
      add-label="+ Legg til medlemskap"
      empty-label="Ingen medlemskap"
      search-placeholder="Søk enhet…"
      picker-chip-aria="Bytt enhet"
      validation-empty="Velg enhet for alle medlemskap før du lagrer."
      show-role
      role-scope="membership"
      default-role="member"
    />

    <RelationListEditor
      :parent-slug="slug"
      :entries="data.attendance.entries"
      :targets="data.attendance.targets"
      :strategy="AttendanceStrategy"
      label="Kurs"
      add-label="+ Legg til kurs"
      empty-label="Ingen kurs"
      search-placeholder="Søk kurs…"
      picker-chip-aria="Bytt kurs"
      validation-empty="Velg kurs for alle oppføringer før du lagrer."
      show-passed
    />

    <RelationListEditor
      :parent-slug="slug"
      :entries="data.operation.entries"
      :targets="data.operation.targets"
      :strategy="OperationStrategy"
      label="Operasjoner"
      add-label="+ Legg til operasjon"
      empty-label="Ingen operasjoner"
      search-placeholder="Søk operasjon…"
      picker-chip-aria="Bytt operasjon"
      validation-empty="Velg operasjon for alle oppføringer før du lagrer."
      :show-dates="false"
      create-label="+ Opprett ny operasjon"
      :create-href="createEventHref?.('operation')"
      :expand-slug="pendingExpandEvent"
    />

    <RelationListEditor
      :parent-slug="slug"
      :entries="data.incident.entries"
      :targets="data.incident.targets"
      :strategy="IncidentStrategy"
      label="Hendelser"
      add-label="+ Legg til hendelse"
      empty-label="Ingen hendelser"
      search-placeholder="Søk hendelse…"
      picker-chip-aria="Bytt hendelse"
      validation-empty="Velg hendelse for alle oppføringer før du lagrer."
      :show-dates="false"
      create-label="+ Opprett ny hendelse"
      :create-href="createEventHref?.('incident')"
      :expand-slug="pendingExpandEvent"
    />

    <RelationListEditor
      :parent-slug="slug"
      :entries="data.stay.entries"
      :targets="data.stay.targets"
      :strategy="PersonStaysStrategy"
      label="Stasjonert på"
      add-label="+ Legg til opphold"
      empty-label="Ingen opphold"
      search-placeholder="Søk sted eller stasjon…"
      picker-chip-aria="Bytt sted"
      validation-empty="Velg sted for alle opphold før du lagrer."
      show-role
      role-scope="stationed"
      default-role="stationed"
      show-sources
      :summary-extra="staySummaryExtra"
    />
  </template>

  <!-- Preview mode: read-only views + shared info popup -->
  <template v-else>
    <RelationListView
      :entries="data.membership.entries"
      :strategy="MembershipStrategy"
      label="Medlemskap"
      show-role
      @open="openMembership"
    />
    <RelationListView
      :entries="data.attendance.entries"
      :strategy="AttendanceStrategy"
      label="Kurs"
      show-passed
      @open="openAttendance"
    />
    <RelationListView
      :entries="data.operation.entries"
      :strategy="OperationStrategy"
      label="Operasjoner"
      @open="openOperation"
    />
    <RelationListView
      :entries="data.incident.entries"
      :strategy="IncidentStrategy"
      label="Hendelser"
      @open="openIncident"
    />
    <RelationListView
      :entries="data.stay.entries"
      :strategy="PersonStaysStrategy"
      label="Vært stasjonert på"
      show-role
      @open="openMembership"
    />
    <RelationInfoPopup
      :entry="activeEntry"
      :show-role="activeShowsRole"
      :show-passed="activeShowsPassed"
      @close="activeEntry = null"
    />
  </template>
</template>

<script setup lang="ts">
/**
 * PersonRelations — composite of the relation slots on a Person page
 * (Medlemskap, Kurs, Operasjoner, Hendelser, Stasjonert på).
 *
 * - `mode === 'edit'`: RelationListEditor instances wired to the
 *   matching strategies + labels.
 * - `mode !== 'edit'`: RelationListView instances + shared
 *   RelationInfoPopup. Component owns the activeEntry/role/passed flags.
 *
 * The parent loads entries/targets via the strategies and passes them in
 * via the `data` prop. Component does not load or save — RelationListEditor
 * handles that internally.
 */
import { ref } from 'vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import RelationListView   from '@/components/relation/RelationListView.vue'
import RelationInfoPopup  from '@/components/relation/RelationInfoPopup.vue'
import {
  MembershipStrategy, AttendanceStrategy,
  IncidentStrategy, OperationStrategy,
} from '@/components/relation/strategies.ts'
import { PersonStaysStrategy, staySummaryExtra } from '@/components/relation/stayStrategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import type { AdminViewMode } from '@/components/AdminViewTabs.vue'

export interface PersonRelationsData {
  membership: { entries: RelationEntry[]; targets: RelationTarget[] }
  attendance: { entries: RelationEntry[]; targets: RelationTarget[] }
  operation:  { entries: RelationEntry[]; targets: RelationTarget[] }
  incident:   { entries: RelationEntry[]; targets: RelationTarget[] }
  stay:       { entries: RelationEntry[]; targets: RelationTarget[] }
}

defineProps<{
  mode:                 AdminViewMode
  slug:                 string
  data:                 PersonRelationsData
  pendingExpandEvent?:  string | null
  /** Returns the `/events/new?...#new` href used by the "+ Opprett ny" button
   *  inside the Operasjon/Hendelse pickers. */
  createEventHref?:    (kind: 'incident' | 'operation') => string
}>()

const activeEntry        = ref<RelationEntry | null>(null)
const activeShowsRole    = ref(false)
const activeShowsPassed  = ref(false)

function openMembership(e: RelationEntry) {
  activeEntry.value       = e
  activeShowsRole.value   = true
  activeShowsPassed.value = false
}
function openAttendance(e: RelationEntry) {
  activeEntry.value       = e
  activeShowsRole.value   = false
  activeShowsPassed.value = true
}
function openOperation(e: RelationEntry) {
  activeEntry.value       = e
  activeShowsRole.value   = false
  activeShowsPassed.value = false
}
function openIncident(e: RelationEntry) {
  activeEntry.value       = e
  activeShowsRole.value   = false
  activeShowsPassed.value = false
}
</script>
