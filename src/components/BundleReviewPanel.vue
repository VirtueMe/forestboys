<template>
  <section class="bundle">
    <p v-if="bundle.error.value" class="error">{{ bundle.error.value }}</p>
    <p v-else-if="bundle.loading.value" class="muted">Laster…</p>

    <article v-if="manifest" class="manifest">
      <header class="manifest-head">
        <dl class="manifest-fields">
          <dt>Bundle</dt><dd><code>{{ manifest.bundleId }}</code></dd>
          <dt>Outline</dt><dd><code>{{ manifest.outlineId }}</code> (rev <code>{{ manifest.outlineRev.slice(0, 8) }}</code>)</dd>
          <dt>Modell</dt><dd>{{ manifest.model }}</dd>
          <dt>Generert</dt><dd>{{ manifest.createdAt }}</dd>
        </dl>
        <button
          v-if="hasPending"
          type="button"
          class="bundle-accept-all"
          :disabled="acceptingAll"
          @click="onAcceptAll"
        >
          {{ acceptingAll ? 'Godkjenner…' : 'Godkjenn alle' }}
        </button>
        <button type="button" class="bundle-delete" :disabled="deleting" @click="onDelete">
          {{ deleting ? 'Sletter…' : 'Slett' }}
        </button>
      </header>
      <p class="summary">{{ manifest.summary }}</p>

      <p v-if="manifest.status === 'blocked'" class="bundle-blocked">
        <strong>Blokkert.</strong>
        Venter på {{ manifest.unresolvedRefs?.length ?? 0 }} barn-bundle{{ (manifest.unresolvedRefs?.length ?? 0) === 1 ? '' : 'r' }}
        som lager:
        <code v-for="r in manifest.unresolvedRefs" :key="r" class="blocked-ref">{{ r }}</code>
      </p>
      <p v-if="manifest.parentBundle" class="bundle-child">
        Barn-bundle for <code>{{ manifest.parentBundle }}</code> — løser <code>{{ (manifest.resolvesEntities ?? []).join(', ') }}</code>.
      </p>
      <nav v-if="olderBundle || newerBundle" class="bundle-nav">
        <button
          v-if="newerBundle"
          type="button"
          class="nav-link nav-newer"
          @click="emit('navigate', newerBundle.bundleId)"
        >
          ‹ Nyere forslag {{ newerBundle.createdAt.slice(0, 10) }}
        </button>
        <span v-else class="nav-spacer"></span>
        <button
          v-if="olderBundle"
          type="button"
          class="nav-link nav-older"
          @click="emit('navigate', olderBundle.bundleId)"
        >
          Eldre forslag {{ olderBundle.createdAt.slice(0, 10) }} ›
        </button>
      </nav>
    </article>

    <section v-if="manifest" class="entity-list">
      <h3 class="section-heading">Påvirkede enheter ({{ manifest.entities.length }})</h3>

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

        <div class="entity-actions">
          <button
            v-if="previewable(entry.entityId)"
            type="button"
            class="action action--preview"
            @click="openPreview(entry.entityId)"
          >
            Forhåndsvis
          </button>
          <template v-if="entry.status === 'pending'">
            <button
              type="button"
              class="action action--accept"
              :disabled="busy === entry.entityId || pendingDeps(entry.entityId).length > 0"
              :title="pendingDeps(entry.entityId).length ? `Venter på: ${pendingDeps(entry.entityId).join(', ')}` : undefined"
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
          </template>
        </div>

        <p v-if="pendingDeps(entry.entityId).length" class="entity-deps">
          Venter på: <code v-for="d in pendingDeps(entry.entityId)" :key="d" class="dep-chip">{{ d }}</code>
        </p>
        <p v-if="actionError[entry.entityId]" class="entity-error">{{ actionError[entry.entityId] }}</p>
      </article>
    </section>

    <AppModal v-model="modalOpen" :title="modalTitle" size="page">
      <EntityPreviewPanel
        v-if="preview"
        :bundle-id="props.bundleId"
        :kind="preview.kind"
        :slug="preview.slug"
        @accepted="onPreviewResolved"
        @denied="onPreviewResolved"
      />
    </AppModal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useProposalBundle, type EntityStatus } from '@/composables/useProposalBundle.ts'
import { authFetch } from '@/composables/useAuth.ts'
import AppModal from '@/components/AppModal.vue'
import EntityPreviewPanel from '@/components/EntityPreviewPanel.vue'

const props = defineProps<{
  bundleId:     string
  olderBundle?: { bundleId: string; createdAt: string }
  newerBundle?: { bundleId: string; createdAt: string }
}>()
const emit = defineEmits<{
  deleted:  []
  navigate: [bundleId: string]
}>()

const bundle   = useProposalBundle(props.bundleId)
const manifest = computed(() => bundle.manifest.value)

const busy        = ref<string | null>(null)
const actionError = ref<Record<string, string>>({})

onMounted(() => { void bundle.load() })

const PREVIEWABLE = new Set(['Person', 'Unit', 'Organization', 'Station', 'Transport', 'Outline', 'Operation', 'Incident', 'Location'])

const preview    = ref<{ kind: string; slug: string } | null>(null)
const modalOpen  = ref(false)
const modalTitle = computed(() => preview.value ? `${preview.value.kind}:${preview.value.slug}` : '')

function previewable(entityId: string): boolean {
  const m = entityId.match(/^([A-Za-z]+):([a-z0-9-]+)$/)
  return !!m && PREVIEWABLE.has(m[1])
}

function openPreview(entityId: string): void {
  const m = entityId.match(/^([A-Za-z]+):([a-z0-9-]+)$/)
  if (!m) return
  preview.value   = { kind: m[1], slug: m[2] }
  modalOpen.value = true
}

function onPreviewResolved(): void {
  modalOpen.value = false
  preview.value   = null
  void bundle.load()  // refresh statuses after accept/deny
}

const hasPending = computed(() => (manifest.value?.entities ?? []).some((e) => e.status === 'pending'))

/**
 * For a given entity, return the list of edge targets that are also
 * being created in the same bundle and are still pending. Disables
 * Godkjenn until those siblings have been accepted (or shows a hint).
 */
function pendingDeps(entityId: string): string[] {
  const m = manifest.value
  if (!m) return []
  const pendingCreates = new Set(
    m.entities
      .filter((e) => e.status === 'pending' && e.entityId !== entityId
                  && e.opSummary.some((s) => s.startsWith('create')))
      .map((e) => e.entityId),
  )
  if (pendingCreates.size === 0) return []
  const payload = bundle.getEntityPayload(entityId)
  if (!payload) return []
  const targets = new Set<string>()
  for (const op of payload.ops) {
    if (op.op === 'add-edge' || op.op === 'remove-edge') targets.add(op.to)
    else if (op.op === 'create-entity') for (const e of op.edges ?? []) targets.add(e.to)
  }
  return [...targets].filter((t) => pendingCreates.has(t))
}

const acceptingAll = ref(false)
async function onAcceptAll(): Promise<void> {
  if (!window.confirm('Godkjenn alle ventende ops i denne bundle? Rekkefølgen tar avhengighet i bundlen i betraktning.')) return
  acceptingAll.value = true
  try {
    const out = await bundle.acceptAll()
    const failed = out.results.filter((r) => r.status === 'failed')
    if (failed.length) {
      window.alert(`${failed.length} ops feilet:\n` + failed.map((f) => `• ${f.entityId}: ${f.reason}`).join('\n'))
    }
  } catch (e) {
    window.alert((e as Error).message)
  } finally {
    acceptingAll.value = false
  }
}

const deleting = ref(false)
async function onDelete(): Promise<void> {
  if (!window.confirm('Slett denne bundle? Alle ops i den forsvinner.')) return
  deleting.value = true
  try {
    const res = await authFetch(`/api/admin/proposals/${encodeURIComponent(props.bundleId)}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      window.alert(body.error ?? `HTTP ${res.status}`)
      return
    }
    emit('deleted')
  } finally {
    deleting.value = false
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

async function onAccept(entityId: string) {
  busy.value = entityId
  delete actionError.value[entityId]
  try {
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
.bundle { display: flex; flex-direction: column; gap: var(--space-md); margin-top: var(--space-md); }

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

.manifest-head { display: flex; align-items: flex-start; gap: var(--space-md); }
.manifest-head .manifest-fields { flex: 1; }
.bundle-delete {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  padding: 4px 10px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
}
.bundle-delete:hover:not([disabled]) { color: var(--danger); border-color: var(--danger); }
.bundle-delete[disabled] { opacity: 0.5; cursor: not-allowed; }

.bundle-accept-all {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--moss);
  color: var(--paper);
  cursor: pointer;
  margin-right: var(--space-xs);
}
.bundle-accept-all:hover:not([disabled]) { filter: brightness(1.1); }
.bundle-accept-all[disabled] { opacity: 0.5; cursor: not-allowed; }

.bundle-blocked {
  margin: var(--space-sm) 0 0;
  padding: 8px 10px;
  background: var(--paper-sunken);
  border-left: 3px solid var(--danger);
  font-size: var(--size-label);
  color: var(--ink);
}
.blocked-ref {
  display: inline-block;
  margin: 0 4px;
  padding: 1px 6px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
}
.bundle-child {
  margin: var(--space-sm) 0 0;
  font-size: var(--size-label);
  color: var(--ink-soft);
}
.bundle-child code { font-family: var(--font-mono); }

.bundle-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-md);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--rule);
}
.nav-spacer { flex: 1; }
.nav-link {
  background: transparent;
  border: none;
  padding: 4px 0;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--focus);
  cursor: pointer;
}
.nav-link:hover { text-decoration: underline; }

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
.action--preview { text-decoration: none; }
.action--preview:hover { background: var(--paper); border-color: var(--ink-soft); }

.entity-error {
  margin: var(--space-sm) 0 0;
  color: var(--danger);
  font-family: var(--font-sans);
  font-size: var(--size-label);
}

.entity-deps {
  margin: var(--space-sm) 0 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
}
.dep-chip {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 6px;
  background: var(--paper-sunken);
  border: 1px solid var(--rule);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
