<template>
  <!-- Edit mode: relation editors -->
  <template v-if="mode === 'edit'">
    <RelationListEditor
      :parent-slug="slug"
      :entries="data.person.entries"
      :targets="data.person.targets"
      :strategy="personStrategy"
      :label="personLabel"
      add-label="+ Legg til person"
      empty-label="Ingen personer knyttet"
      search-placeholder="Søk person…"
      picker-chip-aria="Bytt person"
      validation-empty="Velg person for alle oppføringer før du lagrer."
      :show-dates="false"
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

    <template v-if="kind === 'operation'">
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
    <template v-if="kind === 'operation'">
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
import { ref, computed } from 'vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import RelationListView   from '@/components/relation/RelationListView.vue'
import RelationInfoPopup  from '@/components/relation/RelationInfoPopup.vue'
import {
  PersonInvolvementStrategy, PersonParticipationStrategy,
  SubIncidentsStrategy, SubOperationsStrategy, OperationIncidentsStrategy,
  IncidentInOperationStrategy,
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
}

const props = defineProps<{
  mode: AdminViewMode
  slug: string
  kind: EventKind
  data: EventRelationsData
}>()

const personStrategy = computed(() =>
  props.kind === 'operation' ? PersonParticipationStrategy : PersonInvolvementStrategy,
)
const personLabel = computed(() =>
  props.kind === 'operation' ? 'Deltakere' : 'Involverte personer',
)

const activeEntry = ref<RelationEntry | null>(null)
</script>
