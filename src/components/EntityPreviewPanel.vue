<template>
  <section class="preview-panel">
    <header class="preview-head">
      <span class="entity-id"><code>{{ entityId }}</code></span>
      <span class="status-badge" :class="`status-badge--${status}`">{{ statusLabel(status) }}</span>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <component :is="PersonDetail" v-else-if="kind === 'Person'" />
    <component :is="DistrictDetail" v-else-if="kind === 'Unit'" />
    <component :is="OrganizationDetail" v-else-if="kind === 'Organization'" />
    <component :is="StationDetail" v-else-if="kind === 'Station'" />
    <component :is="TransportDetail" v-else-if="kind === 'Transport'" />
    <component :is="OutlineDetail" v-else-if="kind === 'Outline'" />
    <component :is="EventDetail" v-else-if="kind === 'Operation' || kind === 'Incident'" />
    <component :is="LocationPreviewBody" v-else-if="kind === 'Location'" />
    <component :is="EquipmentDetail" v-else-if="kind === 'EquipmentType'" />
    <ArticlePreviewBody v-else-if="kind === 'Article'" :slug="slug" />
    <SourcePreviewBody v-else-if="kind === 'Source'" :slug="slug" />
    <p v-else class="muted">Ingen forhåndsvisning for kind «{{ kind }}». Forhåndsvisning finnes for {{ PREVIEW_KINDS.join(', ') }}.</p>

    <section v-if="proposedEdges.length" class="edges-pane">
      <h3 class="edges-heading">Foreslåtte koblinger ({{ proposedEdges.length }})</h3>
      <ul class="edges-list">
        <li v-for="(e, i) in proposedEdges" :key="i" class="edge-row">
          <span class="edge-kind">{{ kindLabel(e.targetKind) }}</span>
          <span class="edge-name">{{ targetName(e.to) }}</span>
          <span class="edge-rel">{{ relationLabel(e.type) }}</span>
          <span v-if="e.role" class="edge-role">({{ e.role }})</span>
        </li>
      </ul>
    </section>

    <footer v-if="status === 'pending' && !error && proposalData" class="actions">
      <button type="button" class="action action--accept" :disabled="busy" @click="onAccept">Godkjenn</button>
      <button type="button" class="action action--deny" :disabled="busy" @click="onDeny">Avvis…</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
/**
 * Renders the matching detail component for a kind+slug while providing
 * the proposal-wrapped data composable via the kind's injection key.
 * Re-used by the in-page modal (BundleReviewPanel) and the dedicated
 * preview route (AdminProposalEntityPreview).
 */
import { computed, provide, ref, watch } from 'vue'
import { neo4jQuery } from '@/composables/useNeo4j.ts'

import {
  PersonDataKey, UnitDataKey, OrganizationDataKey, StationDataKey, TransportDataKey,
  OutlineDataKey, EventDataKey, LocationDataKey, EquipmentDataKey, ArticleDataKey, SourceDataKey,
  ProposalPreviewKey, ProposalPreviewSlugKey,
} from '@/composables/proposalDataInjection.ts'
import { useProposalPersonData }       from '@/composables/useProposalPersonData.ts'
import { useProposalUnitData }         from '@/composables/useProposalUnitData.ts'
import { useProposalOrganizationData } from '@/composables/useProposalOrganizationData.ts'
import { useProposalStationData }      from '@/composables/useProposalStationData.ts'
import { useProposalTransportData }    from '@/composables/useProposalTransportData.ts'
import { useProposalOutlineData }      from '@/composables/useProposalOutlineData.ts'
import { useProposalEventData }        from '@/composables/useProposalEventData.ts'
import { useProposalLocationData }     from '@/composables/useProposalLocationData.ts'
import { useProposalEquipmentData }    from '@/composables/useProposalEquipmentData.ts'
import { useProposalArticleData }      from '@/composables/useProposalArticleData.ts'
import { useProposalSourceData }       from '@/composables/useProposalSourceData.ts'
import type { EntityStatus } from '@/composables/useProposalBundle.ts'

import PersonDetail       from '@/pages/PersonDetail.vue'
import DistrictDetail     from '@/pages/DistrictDetail.vue'
import OrganizationDetail from '@/pages/OrganizationDetail.vue'
import StationDetail      from '@/pages/StationDetail.vue'
import TransportDetail    from '@/pages/TransportDetail.vue'
import OutlineDetail      from '@/pages/OutlineDetail.vue'
import EventDetail         from '@/pages/EventDetail.vue'
import LocationPreviewBody from '@/components/LocationPreviewBody.vue'
import EquipmentDetail     from '@/pages/EquipmentDetail.vue'
import ArticlePreviewBody from '@/components/ArticlePreviewBody.vue'
import SourcePreviewBody  from '@/components/SourcePreviewBody.vue'
import { PREVIEW_KINDS } from '@/utils/previewKinds.ts'

const props = defineProps<{ bundleId: string; kind: string; slug: string }>()
const emit  = defineEmits<{ accepted: []; denied: [] }>()

const entityId = `${props.kind}:${props.slug}`

const proposalData =
  props.kind === 'Person'       ? useProposalPersonData(props.bundleId, entityId)       :
  props.kind === 'Unit'         ? useProposalUnitData(props.bundleId, entityId)         :
  props.kind === 'Organization' ? useProposalOrganizationData(props.bundleId, entityId) :
  props.kind === 'Station'      ? useProposalStationData(props.bundleId, entityId)      :
  props.kind === 'Transport'    ? useProposalTransportData(props.bundleId, entityId)    :
  props.kind === 'Outline'      ? useProposalOutlineData(props.bundleId, entityId)      :
  props.kind === 'Operation' || props.kind === 'Incident'
                                ? useProposalEventData(props.bundleId, entityId)        :
  props.kind === 'Location'     ? useProposalLocationData(props.bundleId, entityId)     :
  props.kind === 'EquipmentType' ? useProposalEquipmentData(props.bundleId, entityId)   :
  props.kind === 'Article'      ? useProposalArticleData(props.bundleId, entityId)      :
  props.kind === 'Source'       ? useProposalSourceData(props.bundleId, entityId)       :
  null

provide(ProposalPreviewKey, true)
provide(ProposalPreviewSlugKey, props.slug)

if (proposalData) {
  switch (props.kind) {
    case 'Person':       provide(PersonDataKey,       proposalData as ReturnType<typeof useProposalPersonData>);       break
    case 'Unit':         provide(UnitDataKey,         proposalData as ReturnType<typeof useProposalUnitData>);         break
    case 'Organization': provide(OrganizationDataKey, proposalData as ReturnType<typeof useProposalOrganizationData>); break
    case 'Station':      provide(StationDataKey,      proposalData as ReturnType<typeof useProposalStationData>);      break
    case 'Transport':    provide(TransportDataKey,    proposalData as ReturnType<typeof useProposalTransportData>);    break
    case 'Outline':      provide(OutlineDataKey,      proposalData as ReturnType<typeof useProposalOutlineData>);      break
    case 'Operation':
    case 'Incident':     provide(EventDataKey,        proposalData as ReturnType<typeof useProposalEventData>);        break
    case 'Location':     provide(LocationDataKey,     proposalData as ReturnType<typeof useProposalLocationData>);     break
    case 'EquipmentType': provide(EquipmentDataKey,   proposalData as ReturnType<typeof useProposalEquipmentData>);    break
    case 'Article':      provide(ArticleDataKey,      proposalData as ReturnType<typeof useProposalArticleData>);      break
    case 'Source':       provide(SourceDataKey,       proposalData as ReturnType<typeof useProposalSourceData>);       break
  }
}

const sidecar = computed(() => proposalData?._proposal.value ?? null)
const error   = computed(() => sidecar.value?.error ?? null)
const status  = computed<EntityStatus>(() => sidecar.value?.status ?? 'pending')

interface ProposedEdge { type: string; to: string; targetKind: string; role: string | null }
const proposedEdges = computed<ProposedEdge[]>(() => {
  const payload = sidecar.value?.payload
  if (!payload) return []
  const out: ProposedEdge[] = []
  const kindOf = (id: string) => id.match(/^([A-Za-z]+):/)?.[1] ?? ''
  for (const op of payload.ops) {
    if (op.op === 'create-entity') {
      for (const e of op.edges ?? []) {
        out.push({ type: e.type, to: e.to, targetKind: kindOf(e.to), role: typeof e.props?.role === 'string' ? e.props.role : null })
      }
    } else if (op.op === 'add-edge') {
      out.push({ type: op.type, to: op.to, targetKind: kindOf(op.to), role: typeof op.props?.role === 'string' ? op.props.role : null })
    }
  }
  return out
})

const KIND_LABELS: Record<string, string> = {
  Person: 'Person', Unit: 'Avdeling', Organization: 'Organisasjon',
  Station: 'Stasjon', Transport: 'Fremkomstmiddel',
  Operation: 'Operasjon', Incident: 'Hendelse', Location: 'Sted',
  Outline: 'Informasjon', EquipmentType: 'Utstyr', Article: 'Artikkel', Source: 'Kilde',
}
const RELATION_LABELS: Record<string, string> = {
  PART_OF: 'tilhører', MEMBER_OF: 'medlem', ATTENDED: 'deltok',
  PARTICIPATED_IN: 'deltok i', INVOLVED_IN: 'involvert i',
  ORCHESTRATED_BY: 'ledet av', MENTIONS: 'omtaler', USES_OUTLINE: 'kilde',
  RANK: 'grad', HELD_RANK: 'gradshistorikk', HAS_CONTENT: 'beskrivelse',
}
function kindLabel(k: string): string     { return KIND_LABELS[k]     ?? k.toLowerCase() }
function relationLabel(t: string): string { return RELATION_LABELS[t] ?? t }

const nameByEntityId = ref<Record<string, string>>({})
function targetName(entityId: string): string {
  const cached = nameByEntityId.value[entityId]
  if (cached) return cached
  const slug = entityId.slice(entityId.indexOf(':') + 1)
  return slug
}

// Resolve target names from Neo4j + bundle createOp.props.canonicalName.
watch(proposedEdges, async (edges) => {
  if (!edges.length) return
  const map: Record<string, string> = {}

  // Targets being created in the same bundle: use createOp.props.canonicalName.
  const bundlePayload = proposalData?._proposal.value?.payload ? null : null
  void bundlePayload  // placeholder; cross-entity create lookup is bundle-wide, deferred

  // Group remaining unresolved by kind for batch queries.
  const unresolved = edges.filter((e) => !nameByEntityId.value[e.to])
  const byKind: Record<string, string[]> = {}
  for (const e of unresolved) {
    if (!e.targetKind) continue
    ;(byKind[e.targetKind] ||= []).push(e.to.slice(e.to.indexOf(':') + 1))
  }
  for (const [kind, slugs] of Object.entries(byKind)) {
    try {
      const rows = await neo4jQuery<{ slug: string; name: string }>(
        `MATCH (n:\`${kind}\`) WHERE n.slug IN $slugs
         RETURN n.slug AS slug, coalesce(n.canonicalName, n.title, n.name) AS name`,
        { slugs },
      )
      for (const r of rows) map[`${kind}:${r.slug}`] = r.name
    } catch { /* ignore — falls back to slug */ }
  }
  nameByEntityId.value = { ...nameByEntityId.value, ...map }
}, { immediate: true })

const busy = ref(false)

async function onAccept(): Promise<void> {
  if (!proposalData) return
  busy.value = true
  try {
    await proposalData.accept()
    emit('accepted')
  } catch (e) {
    window.alert((e as Error).message)
  } finally {
    busy.value = false
  }
}

async function onDeny(): Promise<void> {
  if (!proposalData) return
  const reason = window.prompt('Hvorfor avviser du dette forslaget?')
  if (!reason || !reason.trim()) return
  busy.value = true
  try {
    await proposalData.deny(reason.trim())
    emit('denied')
  } catch (e) {
    window.alert((e as Error).message)
  } finally {
    busy.value = false
  }
}

function statusLabel(s: EntityStatus): string {
  switch (s) {
    case 'pending':  return 'Venter'
    case 'accepted': return 'Godkjent'
    case 'denied':   return 'Avvist'
    case 'drifted':  return 'Drift'
  }
}
</script>

<style scoped>
.preview-panel { display: flex; flex-direction: column; min-height: 60vh; }

/* Modal-context: suppress the underlying detail page's back link, which
   would navigate the host page out from under the modal. */
.preview-panel :deep(.back-link) { display: none; }

.preview-head {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
}
.entity-id { flex: 1; color: var(--ink); }
.entity-id code { font-family: var(--font-mono); }

.status-badge {
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-pill);
  border: 1px solid var(--rule);
  background: var(--paper-sunken);
  color: var(--ink-soft);
}
.status-badge--accepted { background: var(--moss); color: var(--paper); border-color: transparent; }
.status-badge--denied   { color: var(--danger); }
.status-badge--drifted  { color: var(--danger); border-color: var(--danger); }

.error { color: var(--danger); padding: var(--space-md); }
.muted { color: var(--muted);  padding: var(--space-md); }

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: var(--space-md);
  border-top: 1px solid var(--rule);
  background: var(--paper-raised);
}

.action {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--rule);
  background: var(--paper-sunken);
  color: var(--ink);
  cursor: pointer;
}
.action[disabled] { opacity: 0.5; cursor: not-allowed; }
.action--accept { background: var(--moss); color: var(--paper); border-color: transparent; }
.action--deny:hover:not([disabled]) { color: var(--danger); border-color: var(--danger); }

.edges-pane {
  padding: var(--space-md);
  border-top: 1px solid var(--rule);
  background: var(--paper-sunken);
}
.edges-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  margin: 0 0 var(--space-sm);
}
.edges-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.edge-row {
  display: flex;
  gap: var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
}
.edge-kind {
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  min-width: 8em;
}
.edge-name { flex: 1; color: var(--ink); font-weight: 500; }
.edge-rel  { color: var(--ink-soft); }
.edge-role { color: var(--muted); font-style: italic; }
</style>
