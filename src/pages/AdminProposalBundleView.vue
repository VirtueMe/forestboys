<template>
  <section class="bundle">
    <header class="bundle-header">
      <h1 class="bundle-title">Forslag</h1>
      <p v-if="bundle.error.value" class="error">{{ bundle.error.value }}</p>
      <p v-else-if="bundle.loading.value" class="muted">Laster…</p>
    </header>

    <article v-if="manifest" class="manifest">
      <dl class="manifest-fields">
        <dt>Bundle</dt><dd><code>{{ manifest.bundleId }}</code></dd>
        <dt>Outline</dt><dd><code>{{ manifest.outlineId }}</code> (rev <code>{{ manifest.outlineRev.slice(0, 8) }}</code>)</dd>
        <dt>Modell</dt><dd>{{ manifest.model }}</dd>
        <dt>Generert</dt><dd>{{ manifest.createdAt }}</dd>
      </dl>
      <p class="summary">{{ manifest.summary }}</p>
    </article>

    <section v-if="manifest" class="entity-list">
      <h2 class="section-heading">Påvirkede enheter ({{ manifest.entities.length }})</h2>

      <article
        v-for="entry in manifest.entities"
        :key="entry.entityId"
        class="entity-card"
        :class="`entity-card--${entry.status}`"
      >
        <header class="entity-head">
          <h3 class="entity-id"><code>{{ entry.entityId }}</code></h3>
          <span class="status-badge" :class="`status-badge--${entry.status}`">{{ statusLabel(entry.status) }}</span>
        </header>

        <ul class="op-summary">
          <li v-for="(op, i) in entry.opSummary" :key="i">{{ op }}</li>
        </ul>

        <div v-if="entry.status === 'pending'" class="entity-actions">
          <button
            type="button"
            class="action action--accept"
            :disabled="busy === entry.entityId"
            @click="onAccept(entry.entityId)"
          >
            Godkjenn
          </button>
          <button
            type="button"
            class="action action--deny"
            :disabled="busy === entry.entityId"
            @click="onDeny(entry.entityId)"
          >
            Avvis…
          </button>
        </div>

        <p v-if="actionError[entry.entityId]" class="entity-error">{{ actionError[entry.entityId] }}</p>
      </article>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useProposalBundle, type EntityStatus } from '@/composables/useProposalBundle.ts'

const route    = useRoute()
const bundleId = computed(() => String(route.params.bundleId))
const bundle   = useProposalBundle(bundleId.value)
const manifest = computed(() => bundle.manifest.value)

const busy        = ref<string | null>(null)
const actionError = ref<Record<string, string>>({})

onMounted(() => {
  void bundle.load()
})

function statusLabel(s: EntityStatus): string {
  switch (s) {
    case 'pending':  return 'Venter'
    case 'accepted': return 'Godkjent'
    case 'denied':   return 'Avvist'
    case 'drifted':  return 'Drift'
  }
}

async function onAccept(entityId: string) {
  busy.value = entityId
  delete actionError.value[entityId]
  try {
    // v1: expectedShas is empty — server will compute drift on the live
    // sha and reject if Jan's view is stale. For per-block drift surfacing
    // Jan needs the controller-view preview (separate followup).
    await bundle.accept(entityId, {})
  } catch (e) {
    const err = e as Error & { driftedBlocks?: unknown[] }
    if (err.driftedBlocks?.length) {
      actionError.value[entityId] = `Drift på ${err.driftedBlocks.length} blokk(er) — last siden på nytt før du godkjenner.`
    } else {
      actionError.value[entityId] = err.message
    }
  } finally {
    busy.value = null
  }
}

async function onDeny(entityId: string) {
  const reason = window.prompt('Hvorfor avviser du dette forslaget? (Begrunnelsen brukes til å lære boten.)')
  if (!reason || !reason.trim()) return
  busy.value = entityId
  delete actionError.value[entityId]
  try {
    await bundle.deny(entityId, reason.trim())
  } catch (e) {
    actionError.value[entityId] = (e as Error).message
  } finally {
    busy.value = null
  }
}
</script>

<style scoped>
.bundle {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--space-md) var(--space-md) var(--space-xl);
}

.bundle-title {
  font-family: var(--font-serif);
  font-size: var(--size-h1);
  margin: 0 0 var(--space-xs);
}
.muted { color: var(--muted); }
.error { color: var(--danger); }

.manifest {
  margin-bottom: var(--space-lg);
  padding: var(--space-md);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}

.manifest-fields {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-xs) var(--space-md);
  margin: 0 0 var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
}
.manifest-fields dt {
  font-weight: 600;
  color: var(--ink-soft);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
}
.manifest-fields dd {
  margin: 0;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.summary {
  margin: 0;
  font-family: var(--font-serif);
  font-size: var(--size-body);
  color: var(--ink);
}

.section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  margin: 0 0 var(--space-sm);
}

.entity-list { display: flex; flex-direction: column; gap: var(--space-md); }

.entity-card {
  padding: var(--space-md);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  transition: opacity 120ms ease-out;
}
.entity-card--accepted { opacity: 0.6; }
.entity-card--denied   { opacity: 0.5; }

.entity-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}
.entity-id { margin: 0; font-family: var(--font-sans); font-size: var(--size-body-ui); }
.entity-id code { font-family: var(--font-mono); }

.status-badge {
  font-family: var(--font-sans);
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
.status-badge--denied   { background: var(--paper-sunken); color: var(--danger); border-color: var(--rule); }
.status-badge--drifted  { background: var(--paper-sunken); color: var(--danger); border-color: var(--danger); }

.op-summary {
  list-style: disc inside;
  margin: 0 0 var(--space-md);
  padding: 0;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
}
.op-summary li { padding: var(--space-xs) 0; }

.entity-actions {
  display: flex;
  gap: var(--space-sm);
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
  transition: background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out;
}
.action:hover:not([disabled]) {
  background: var(--paper);
  border-color: var(--ink-soft);
}
.action[disabled] { opacity: 0.5; cursor: not-allowed; }
.action--accept { background: var(--moss); color: var(--paper); border-color: transparent; }
.action--accept:hover:not([disabled]) { filter: brightness(1.1); border-color: transparent; }
.action--deny:hover:not([disabled])   { color: var(--danger); border-color: var(--danger); }

.entity-error {
  margin: var(--space-sm) 0 0;
  color: var(--danger);
  font-family: var(--font-sans);
  font-size: var(--size-label);
}
</style>
