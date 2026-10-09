<template>
  <section class="archived-page">
    <header class="page-head">
      <h1>Arkivert bundle</h1>
      <p class="muted"><RouterLink to="/admin/proposals/archive">Til Arkiv</RouterLink> · <RouterLink to="/admin/proposals">Til forslagene</RouterLink></p>
    </header>

    <p v-if="error" class="error">
      {{ error }}
      <template v-if="notFound"> Den er ikke arkivert (kanskje gjenopprettet eller fjernet for godt). <RouterLink :to="`/admin/proposals/${encodeURIComponent(bundleId)}`">Prøv bundlen</RouterLink></template>
    </p>
    <p v-else-if="loading" class="muted">Laster…</p>

    <template v-else-if="data">
      <article class="card">
        <dl class="fields">
          <dt>Status</dt>
          <dd><span class="bundle-status" :class="`bundle-status--${data.archive.status}`">{{ bundleStatusLabel(data.archive.status) }}</span> <span class="muted">{{ countsText }}</span></dd>
          <dt>Bundle</dt><dd><code>{{ data.archive.bundleId }}</code></dd>
          <dt>Arkivert</dt><dd>{{ data.archive.archivedAt.slice(0, 16).replace('T', ' ') }} av <strong>{{ data.archive.archivedBy }}</strong></dd>
          <dt>Hvorfor</dt><dd>{{ data.archive.reason }}</dd>
        </dl>
        <p class="summary">{{ data.archive.summary }}</p>

        <div class="actions">
          <button v-if="data.archive.restorable" type="button" class="action" :disabled="busy" @click="restore">Gjenopprett</button>
          <p v-else class="muted">Noe i denne bundlen er godkjent: endringene ligger i grafen. Den kan ikke gjenopprettes, bare leses.</p>
          <button type="button" class="action action--danger" :disabled="busy" @click="purge">Fjern for godt…</button>
        </div>
        <p v-if="actionError" class="error">{{ actionError }}</p>
      </article>

      <section v-if="data.manifest" class="block">
        <h2 class="section-heading">Enheter ({{ data.manifest.entities.length }})</h2>
        <ul class="entities">
          <li v-for="e in data.manifest.entities" :key="e.entityId">
            <code>{{ e.entityId }}</code>
            <span class="status-badge" :class="`status-badge--${e.status}`">{{ entityStatusLabel(e.status) }}</span>
            <span class="muted">{{ e.opSummary.join(', ') }}</span>
            <span v-if="e.refusal?.length" class="refusal">{{ refusalsText(e.refusal) }}</span>
          </li>
        </ul>
      </section>

      <section class="block">
        <h2 class="section-heading">Kommentarer ({{ data.comments.length }})</h2>
        <p v-if="!data.comments.length" class="muted">Ingen kommentarer.</p>
        <ol v-else class="comments">
          <li v-for="c in data.comments" :key="c.id">
            <strong>{{ actorName(c.actor) }}</strong>
            <time :datetime="c.at">{{ c.at.slice(0, 16).replace('T', ' ') }}</time>
            <span v-if="c.entityId" class="muted"> om <code>{{ c.entityId }}</code></span>
            <p>{{ c.text }}</p>
          </li>
        </ol>
      </section>

      <section class="block">
        <h2 class="section-heading">Historikk</h2>
        <p v-if="!data.events.length" class="muted">Ingen hendelser.</p>
        <ol v-else class="events">
          <li v-for="ev in data.events" :key="ev.id">
            <time :datetime="ev.at">{{ ev.at.slice(0, 16).replace('T', ' ') }}</time>
            <strong>{{ actorName(ev.actor) }}</strong>
            <span>{{ eventText(ev) }}</span>
          </li>
        </ol>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { authFetch } from '@/composables/useAuth.ts'
import { bundleStatusLabel } from '@/utils/bundleStatus.ts'
import { actorName, eventText, type BundleEvent } from '@/utils/bundleEvents.ts'
import { refusalsText, type Refusal } from '@/utils/refusalText.ts'
import type { ArchiveSummary } from '@/utils/bundleArchive.ts'
import type { BundleComment } from '@/utils/bundleComments.ts'

interface ArchivedManifest { entities: { entityId: string; status: string; opSummary: string[]; refusal?: Refusal[] }[] }
interface ArchivedBundle { archive: ArchiveSummary; manifest: ArchivedManifest | null; events: BundleEvent[]; comments: BundleComment[] }

const route    = useRoute()
const router   = useRouter()
const bundleId = String(route.params.bundleId)
const base     = `/api/admin/proposals/archive/${encodeURIComponent(bundleId)}`

const data        = ref<ArchivedBundle | null>(null)
const loading     = ref(true)
const busy        = ref(false)
const error       = ref<string | null>(null)
const notFound    = ref(false)
const actionError = ref<string | null>(null)

const countsText = computed(() => {
  const c = data.value?.archive.counts
  if (!c) return ''
  return [c.pending && `${c.pending} ventet`, c.accepted && `${c.accepted} godkjent`, c.denied && `${c.denied} avvist`, c.drifted && `${c.drifted} satt til side`].filter(Boolean).join(' · ')
})

function entityStatusLabel(s: string): string {
  return ({ pending: 'Venter', accepted: 'Godkjent', denied: 'Avvist', drifted: 'Satt til side' } as Record<string, string>)[s] ?? s
}

async function load(): Promise<void> {
  try {
    const res = await authFetch(base)
    if (res.status === 404) { notFound.value = true; throw new Error('Bundlen finnes ikke i arkivet.') }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data.value = await res.json() as ArchivedBundle
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function send(request: Promise<Response>): Promise<boolean> {
  busy.value = true
  actionError.value = null
  try {
    const res = await request
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      actionError.value = body.error ?? `HTTP ${res.status}`
      return false
    }
    return true
  } finally {
    busy.value = false
  }
}

async function restore(): Promise<void> {
  // Cancel stops it; an empty answer restores it without a comment.
  const reason = window.prompt('Gjenopprette bundlen? Skriv gjerne hvorfor (valgfritt). Det blir en kommentar på bundlen.')
  if (reason === null) return
  const request = authFetch(`${base}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) })
  if (await send(request)) void router.replace(`/admin/proposals/${encodeURIComponent(bundleId)}`)
}

async function purge(): Promise<void> {
  const reason = window.prompt('Fjerne for godt? Hele bundlen, loggen og kommentarene slettes og kan ikke hentes tilbake. Bare en kort post om hvem, når og hvorfor blir igjen. Hvorfor fjerner du den?')?.trim()
  if (!reason) return
  const ok = await send(authFetch(base, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }))
  if (ok) void router.replace('/admin/proposals/archive')
}

onMounted(() => { void load() })
</script>

<style scoped>
.archived-page { max-width: 900px; margin: 0 auto; padding: var(--space-md); }
.page-head h1 { margin: 0 0 var(--space-xs); font-family: var(--font-serif); font-size: var(--size-h1); }
.muted { color: var(--muted); }
.error { color: var(--danger); }

.card { margin: var(--space-md) 0 var(--space-lg); padding: var(--space-md); background: var(--paper-raised); border: 1px solid var(--rule); border-radius: var(--radius-md); }
.fields { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-xs) var(--space-md); margin: 0 0 var(--space-md); }
.fields dt { color: var(--muted); text-transform: uppercase; font-size: var(--size-caps); letter-spacing: var(--tracking-caps); }
.fields dd { margin: 0; }
.actions { display: flex; gap: var(--space-md); align-items: center; flex-wrap: wrap; }
.action { font: inherit; padding: 4px 12px; cursor: pointer; background: var(--paper-sunken); border: 1px solid var(--rule); border-radius: var(--radius-md); color: var(--ink); }
.action--danger { color: var(--danger); border-color: var(--danger); }
.action:disabled { opacity: .5; cursor: default; }

.block { margin-bottom: var(--space-lg); }
.entities, .comments, .events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-xs); }
.entities li { display: flex; gap: var(--space-md); align-items: baseline; flex-wrap: wrap; }
.refusal { color: var(--danger); }
.comments p { margin: 0 0 var(--space-xs); white-space: pre-wrap; }
.comments time, .events time { color: var(--muted); font-family: var(--font-mono); font-size: 12px; }
.events li { display: grid; grid-template-columns: max-content max-content 1fr; gap: var(--space-md); align-items: baseline; }

.bundle-status, .status-badge {
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  border: 1px solid var(--rule);
  background: var(--paper-sunken);
  color: var(--ink-soft);
}
.bundle-status--blocked { color: var(--danger); border-color: var(--danger); }
.bundle-status--closed, .status-badge--accepted { color: var(--moss); border-color: var(--moss); }
.status-badge--denied, .status-badge--drifted { color: var(--danger); border-color: var(--danger); }
@media (max-width: 600px) { .events li { grid-template-columns: 1fr; gap: 0; } }
</style>
