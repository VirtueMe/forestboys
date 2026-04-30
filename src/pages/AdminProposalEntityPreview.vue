<template>
  <section class="preview">
    <header class="preview-header">
      <RouterLink :to="`/admin/proposals/${bundleId}`" class="back-link">← Tilbake til forslag</RouterLink>
      <span class="entity-id"><code>{{ entityId }}</code></span>
      <span class="status-badge" :class="`status-badge--${status}`">{{ statusLabel(status) }}</span>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <component :is="PersonDetail" v-else-if="kind === 'Person'" />
    <component :is="DistrictDetail" v-else-if="kind === 'Unit'" />
    <component :is="OrganizationDetail" v-else-if="kind === 'Organization'" />
    <component :is="StationDetail" v-else-if="kind === 'Station'" />
    <component :is="TransportDetail" v-else-if="kind === 'Transport'" />
    <p v-else class="muted">Ingen forhåndsvisning for kind «{{ kind }}» (Incident / Operation / Outline / Location).</p>

    <footer v-if="status === 'pending' && !error && proposalData" class="actions">
      <button type="button" class="action action--accept" :disabled="busy" @click="onAccept">Godkjenn</button>
      <button type="button" class="action action--deny" :disabled="busy" @click="onDeny">Avvis…</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
/**
 * /admin/proposals/:bundleId/preview/:kind/:slug — controller-view preview.
 *
 * Mounts the matching detail page (PersonDetail / DistrictDetail / …)
 * and provides a proposal-wrapped data composable via the matching
 * injection key. The detail page's DetailPage shell watches
 * `route.params.slug` and triggers the proposal composable's load,
 * same shape as the live flow.
 *
 * Out-of-scope kinds (Incident / Operation / Outline / Location) fall
 * back to a placeholder until their data composables exist.
 */
import { computed, provide, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  PersonDataKey, UnitDataKey, OrganizationDataKey, StationDataKey, TransportDataKey,
} from '@/composables/proposalDataInjection.ts'
import { useProposalPersonData }       from '@/composables/useProposalPersonData.ts'
import { useProposalUnitData }         from '@/composables/useProposalUnitData.ts'
import { useProposalOrganizationData } from '@/composables/useProposalOrganizationData.ts'
import { useProposalStationData }      from '@/composables/useProposalStationData.ts'
import { useProposalTransportData }    from '@/composables/useProposalTransportData.ts'
import type { EntityStatus } from '@/composables/useProposalBundle.ts'

import PersonDetail       from './PersonDetail.vue'
import DistrictDetail     from './DistrictDetail.vue'
import OrganizationDetail from './OrganizationDetail.vue'
import StationDetail      from './StationDetail.vue'
import TransportDetail    from './TransportDetail.vue'

const route  = useRoute()
const router = useRouter()

const bundleId = String(route.params.bundleId)
const kind     = String(route.params.kind)
const slug     = String(route.params.slug)
const entityId = `${kind}:${slug}`

const proposalData =
  kind === 'Person'       ? useProposalPersonData(bundleId, entityId)       :
  kind === 'Unit'         ? useProposalUnitData(bundleId, entityId)         :
  kind === 'Organization' ? useProposalOrganizationData(bundleId, entityId) :
  kind === 'Station'      ? useProposalStationData(bundleId, entityId)      :
  kind === 'Transport'    ? useProposalTransportData(bundleId, entityId)    :
  null

if (proposalData) {
  switch (kind) {
    case 'Person':       provide(PersonDataKey,       proposalData as ReturnType<typeof useProposalPersonData>);       break
    case 'Unit':         provide(UnitDataKey,         proposalData as ReturnType<typeof useProposalUnitData>);         break
    case 'Organization': provide(OrganizationDataKey, proposalData as ReturnType<typeof useProposalOrganizationData>); break
    case 'Station':      provide(StationDataKey,      proposalData as ReturnType<typeof useProposalStationData>);      break
    case 'Transport':    provide(TransportDataKey,    proposalData as ReturnType<typeof useProposalTransportData>);    break
  }
}

const sidecar = computed(() => proposalData?._proposal.value ?? null)
const error   = computed(() => sidecar.value?.error ?? null)
const status  = computed<EntityStatus>(() => sidecar.value?.status ?? 'pending')

const busy = ref(false)

async function onAccept() {
  if (!proposalData) return
  busy.value = true
  try {
    await proposalData.accept()
    void router.push(`/admin/proposals/${bundleId}`)
  } catch (e) {
    window.alert((e as Error).message)
  } finally {
    busy.value = false
  }
}

async function onDeny() {
  if (!proposalData) return
  const reason = window.prompt('Hvorfor avviser du dette forslaget?')
  if (!reason || !reason.trim()) return
  busy.value = true
  try {
    await proposalData.deny(reason.trim())
    void router.push(`/admin/proposals/${bundleId}`)
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
.preview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
}
.back-link {
  color: var(--ink-soft);
  text-decoration: none;
}
.back-link:hover { color: var(--ink); }
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
.status-badge--denied   { color: var(--danger); border-color: var(--rule); }
.status-badge--drifted  { color: var(--danger); border-color: var(--danger); }

.error  { color: var(--danger); padding: var(--space-md); }
.muted  { color: var(--muted);  padding: var(--space-md); }

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
.action--deny:hover:not([disabled])   { color: var(--danger); border-color: var(--danger); }
</style>
