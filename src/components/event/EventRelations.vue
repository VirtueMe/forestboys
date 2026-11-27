<template>
  <!-- Edit mode: relation editors -->
  <template v-if="mode === 'edit'">
    <RelationListEditor
      ref="personEditor"
      :parent-slug="slug"
      :entries="data.person.entries"
      :targets="data.person.targets"
      :strategy="personStrategy"
      :label="personLabel"
      add-label="+ Legg til person"
      reorderable
      empty-label="Ingen personer knyttet"
      search-placeholder="Søk person…"
      picker-chip-aria="Bytt person"
      validation-empty="Velg person for alle oppføringer før du lagrer."
      :show-dates="false"
      @saved="onPeopleSaved"
    />

    <RelationListEditor
      v-if="kind === 'incident'"
      :parent-slug="slug"
      :entries="data.inOperation.entries"
      :targets="data.inOperation.targets"
      :strategy="IncidentInOperationStrategy"
      label="Del av operasjon"
      add-label="+ Knytt til operasjon"
      empty-label="Ikke knyttet til en operasjon"
      search-placeholder="Søk operasjon…"
      picker-chip-aria="Bytt operasjon"
      validation-empty="Velg operasjon eller fjern oppføringen før du lagrer."
      :show-dates="false"
      :show-description="false"
    />

    <template v-if="kind === 'incident'">
      <RelationListEditor
        :parent-slug="slug"
        :entries="data.atLocation.entries"
        :targets="data.atLocation.targets"
        :strategy="IncidentAtLocationStrategy"
        label="Sted"
        add-label="+ Legg til sted"
        empty-label="Ingen sted angitt"
        search-placeholder="Søk sted…"
        picker-chip-aria="Bytt sted"
        validation-empty="Velg sted eller fjern oppføringen før du lagrer."
        :show-dates="false"
        :show-description="false"
      />

      <RelationListEditor
        :parent-slug="slug"
        :entries="data.atStation.entries"
        :targets="data.atStation.targets"
        :strategy="IncidentAtStationStrategy"
        label="Base"
        add-label="+ Legg til base"
        empty-label="Ingen base angitt"
        search-placeholder="Søk base…"
        picker-chip-aria="Bytt base"
        validation-empty="Velg base eller fjern oppføringen før du lagrer."
        :show-dates="false"
        :show-description="false"
      />
    </template>

    <RelationListEditor
      v-if="kind === 'incident'"
      :parent-slug="slug"
      :entries="data.subIncident.entries"
      :targets="data.subIncident.targets"
      :strategy="SubIncidentsStrategy"
      label="Relaterte hendelser"
      add-label="+ Legg til relatert hendelse"
      empty-label="Ingen relaterte hendelser"
      search-placeholder="Søk hendelse…"
      picker-chip-aria="Bytt hendelse"
      validation-empty="Velg hendelse for alle oppføringer før du lagrer."
      :show-dates="false"
      :show-description="false"
    />

    <RelationListEditor
      ref="transportEditor"
      :parent-slug="slug"
      :entries="data.transport.entries"
      :targets="data.transport.targets"
      :strategy="EventTransportCrewStrategy"
      label="Transportmidler"
      add-label="+ Legg til transportmiddel"
      reorderable
      empty-label="Ingen transportmidler knyttet"
      search-placeholder="Søk transportmiddel…"
      picker-chip-aria="Bytt transportmiddel"
      validation-empty="Velg transportmiddel for alle oppføringer før du lagrer."
      :show-dates="false"
      :show-description="false"
      :signature-extra="crewSignature"
      :summary-extra="crewSummary"
      @saved="adoptCrew"
    >
      <template #extra-fields="{ entry }">
        <EventCrewFields :entry="entry" :targets="data.person.targets" :date="date" />
      </template>
    </RelationListEditor>

    <template v-if="kind === 'operation'">
      <RelationListEditor
        :parent-slug="slug"
        :entries="data.org.entries"
        :targets="data.org.targets"
        :strategy="OperationOrganizationsStrategy"
        label="Organisasjoner"
        add-label="+ Legg til organisasjon"
        empty-label="Ingen organisasjoner knyttet"
        search-placeholder="Søk organisasjon…"
        picker-chip-aria="Bytt organisasjon"
        validation-empty="Velg organisasjon for alle oppføringer før du lagrer."
        :show-dates="false"
        :show-description="false"
      />

      <RelationListEditor
        :parent-slug="slug"
        :entries="data.unit.entries"
        :targets="data.unit.targets"
        :strategy="OperationUnitsStrategy"
        label="Avdelinger"
        add-label="+ Legg til avdeling"
        empty-label="Ingen avdelinger knyttet"
        search-placeholder="Søk avdeling…"
        picker-chip-aria="Bytt avdeling"
        validation-empty="Velg avdeling for alle oppføringer før du lagrer."
        :show-dates="false"
        :show-description="false"
      />

      <RelationListEditor
        :parent-slug="slug"
        :entries="data.fromLocation.entries"
        :targets="data.fromLocation.targets"
        :strategy="OperationFromLocationStrategy"
        label="Fra Sted"
        add-label="+ Legg til startsted"
        empty-label="Ingen startsted"
        search-placeholder="Søk sted…"
        picker-chip-aria="Bytt sted"
        validation-empty="Velg sted eller fjern oppføringen før du lagrer."
        :show-dates="false"
        :show-description="false"
      />

      <RelationListEditor
        :parent-slug="slug"
        :entries="data.toLocation.entries"
        :targets="data.toLocation.targets"
        :strategy="OperationToLocationStrategy"
        label="Til Sted"
        add-label="+ Legg til endesteder"
        empty-label="Ingen endesteder"
        search-placeholder="Søk sted…"
        picker-chip-aria="Bytt sted"
        validation-empty="Velg sted eller fjern oppføringen før du lagrer."
        :show-dates="false"
        :show-description="false"
      />

      <RelationListEditor
        :parent-slug="slug"
        :entries="data.fromStation.entries"
        :targets="data.fromStation.targets"
        :strategy="OperationFromStationStrategy"
        label="Fra Base"
        add-label="+ Legg til startbase"
        empty-label="Ingen startbase"
        search-placeholder="Søk base…"
        picker-chip-aria="Bytt base"
        validation-empty="Velg base eller fjern oppføringen før du lagrer."
        :show-dates="false"
        :show-description="false"
      />

      <RelationListEditor
        :parent-slug="slug"
        :entries="data.toStation.entries"
        :targets="data.toStation.targets"
        :strategy="OperationToStationStrategy"
        label="Til Base"
        add-label="+ Legg til endebase"
        empty-label="Ingen endebase"
        search-placeholder="Søk base…"
        picker-chip-aria="Bytt base"
        validation-empty="Velg base eller fjern oppføringen før du lagrer."
        :show-dates="false"
        :show-description="false"
      />

      <RelationListEditor
        :parent-slug="slug"
        :entries="data.opIncident.entries"
        :targets="data.opIncident.targets"
        :strategy="OperationIncidentsStrategy"
        label="Hendelser i operasjonen"
        add-label="+ Legg til hendelse"
        empty-label="Ingen hendelser knyttet"
        search-placeholder="Søk hendelse…"
        picker-chip-aria="Bytt hendelse"
        validation-empty="Velg hendelse for alle oppføringer før du lagrer."
        :show-dates="false"
        :show-description="false"
      />

      <RelationListEditor
        :parent-slug="slug"
        :entries="data.subOperation.entries"
        :targets="data.subOperation.targets"
        :strategy="SubOperationsStrategy"
        label="Deloperasjoner"
        add-label="+ Legg til deloperasjon"
        empty-label="Ingen deloperasjoner"
        search-placeholder="Søk operasjon…"
        picker-chip-aria="Bytt operasjon"
        validation-empty="Velg operasjon for alle oppføringer før du lagrer."
        :show-dates="false"
        :show-description="false"
      />
    </template>
  </template>

  <!-- Preview mode: read-only views + shared info popup -->
  <template v-else>
    <RelationListView
      :entries="data.person.entries"
      :strategy="personStrategy"
      :label="personLabel"
      @open="e => activeEntry = e"
    />
    <RelationListView
      v-if="kind === 'incident' && data.inOperation.entries.length"
      :entries="data.inOperation.entries"
      :strategy="IncidentInOperationStrategy"
      label="Del av operasjon"
      @open="e => activeEntry = e"
    />
    <RelationListView
      v-if="kind === 'incident'"
      :entries="data.subIncident.entries"
      :strategy="SubIncidentsStrategy"
      label="Relaterte hendelser"
      @open="e => activeEntry = e"
    />
    <RelationListView
      v-if="data.transport.entries.length"
      :entries="data.transport.entries"
      :strategy="EventTransportCrewStrategy"
      label="Transportmidler"
      @open="e => activeEntry = e"
    />
    <template v-if="kind === 'operation'">
      <RelationListView
        v-if="data.org.entries.length"
        :entries="data.org.entries"
        :strategy="OperationOrganizationsStrategy"
        label="Organisasjoner"
        @open="e => activeEntry = e"
      />
      <RelationListView
        v-if="data.unit.entries.length"
        :entries="data.unit.entries"
        :strategy="OperationUnitsStrategy"
        label="Avdelinger"
        @open="e => activeEntry = e"
      />
      <RelationListView
        :entries="data.opIncident.entries"
        :strategy="OperationIncidentsStrategy"
        label="Hendelser i operasjonen"
        @open="e => activeEntry = e"
      />
      <RelationListView
        :entries="data.subOperation.entries"
        :strategy="SubOperationsStrategy"
        label="Deloperasjoner"
        @open="e => activeEntry = e"
      />
    </template>
    <RelationInfoPopup :entry="activeEntry" @close="activeEntry = null" />
  </template>
</template>

<script setup lang="ts">
/**
 * EventRelations — composite of all relation slots on an Incident/Operation
 * page. Mirrors PersonRelations: edit mode renders RelationListEditor for
 * each kind-appropriate slot; preview mode renders read-only views with a
 * shared info popup.
 *
 * Person strategy switches by event kind (Involvement vs Participation).
 * Hierarchy slots vary: incidents have sub-incidents only; operations have
 * both op→incidents and sub-operations.
 */
import { ref, computed, useTemplateRef } from 'vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import RelationListView   from '@/components/relation/RelationListView.vue'
import RelationInfoPopup  from '@/components/relation/RelationInfoPopup.vue'
import EventCrewFields    from './EventCrewFields.vue'
import { EventTransportCrewStrategy } from '@/components/relation/eventCrew.ts'
import {
  PersonInvolvementStrategy, PersonParticipationStrategy,
  SubIncidentsStrategy, SubOperationsStrategy, OperationIncidentsStrategy,
  IncidentInOperationStrategy,
  OperationOrganizationsStrategy, OperationUnitsStrategy,
  OperationFromLocationStrategy, OperationToLocationStrategy,
  OperationFromStationStrategy,  OperationToStationStrategy,
  IncidentAtLocationStrategy,    IncidentAtStationStrategy,
} from '@/components/relation/strategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import type { AdminViewMode } from '@/components/AdminViewTabs.vue'
import type { EventKind } from '@/composables/useEventData.ts'

export interface EventRelationsData {
  person:       { entries: RelationEntry[]; targets: RelationTarget[] }
  subIncident:  { entries: RelationEntry[]; targets: RelationTarget[] }
  subOperation: { entries: RelationEntry[]; targets: RelationTarget[] }
  opIncident:   { entries: RelationEntry[]; targets: RelationTarget[] }
  inOperation:  { entries: RelationEntry[]; targets: RelationTarget[] }
  org:          { entries: RelationEntry[]; targets: RelationTarget[] }
  unit:         { entries: RelationEntry[]; targets: RelationTarget[] }
  transport:    { entries: RelationEntry[]; targets: RelationTarget[] }
  fromLocation: { entries: RelationEntry[]; targets: RelationTarget[] }
  toLocation:   { entries: RelationEntry[]; targets: RelationTarget[] }
  fromStation:  { entries: RelationEntry[]; targets: RelationTarget[] }
  toStation:    { entries: RelationEntry[]; targets: RelationTarget[] }
  atLocation:   { entries: RelationEntry[]; targets: RelationTarget[] }
  atStation:    { entries: RelationEntry[]; targets: RelationTarget[] }
}

const props = defineProps<{
  mode: AdminViewMode
  slug: string
  kind: EventKind
  data: EventRelationsData
  /** The event's date: which of a transport's regular crew «Hent fast mannskap» takes. */
  date?: string | null
}>()

const personStrategy = computed(() =>
  props.kind === 'operation' ? PersonParticipationStrategy : PersonInvolvementStrategy,
)
const personLabel = computed(() =>
  props.kind === 'operation' ? 'Deltakere' : 'Involverte personer',
)

const activeEntry = ref<RelationEntry | null>(null)

// The people and transport lists are saved one at a time and each save can change the other: keep them in step
// without reloading over unsaved changes.
const personEditor    = useTemplateRef<InstanceType<typeof RelationListEditor> | null>('personEditor')
const transportEditor = useTemplateRef<InstanceType<typeof RelationListEditor> | null>('transportEditor')

const crewSignature = (t: RelationEntry) => JSON.stringify((t.crew ?? []).map(c => [c.targetSlug, c.role ?? null]))
const crewSummary   = (t: RelationEntry) => t.crew?.length ? `${t.crew.length} mannskap` : ''

/** Saving crew added these people to the event on the server. */
function adoptCrew() {
  const have = new Set(props.data.person.entries.map(e => e.targetSlug))
  const added = new Map(props.data.transport.entries.flatMap(t => t.crew ?? [])
    .filter(c => !have.has(c.targetSlug)).map(c => [c.targetSlug, c]))
  personEditor.value?.adopt([...added.values()].map(c => ({ ...c, edgeId: null, role: undefined })))
}

/** Someone taken off the people list has lost their saved crew assignments. */
function onPeopleSaved() {
  const have = new Set(props.data.person.entries.map(e => e.targetSlug))
  transportEditor.value?.patch(t => { t.crew = t.crew?.filter(c => !c.edgeId || have.has(c.targetSlug)) })
}
</script>
