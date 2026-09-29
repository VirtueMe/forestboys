<template>
  <section class="edit-section">
    <div class="edit-section-head">
      <h3 class="edit-section-heading">Grad</h3>
    </div>
    <div class="known-rank-row">
      <select v-model="draftSlug" class="edit-input known-rank-select" aria-label="Grad">
        <option :value="null" disabled>Velg grad</option>
        <option v-for="opt in options" :key="opt.slug" :value="opt.slug">{{ opt.name }}</option>
      </select>
      <span v-if="known?.state === 'candidate'" class="known-rank-state">fra Sanity, ikke gjennomgått</span>
    </div>
    <p v-if="mismatch" class="known-rank-hint">
      Historikken slutter på {{ mismatch.targetName }}, grad er {{ draftName }}.
      <button type="button" class="edit-link" @click="draftSlug = mismatch.targetSlug">Bruk {{ mismatch.targetName }}</button>
    </p>
  </section>

  <footer v-if="dirty" class="edit-save-bar">
    <span class="edit-save-prompt">Ser det bra ut?</span>
    <button type="button" class="edit-btn-primary" :disabled="saving" @click="save">
      {{ saving ? 'Lagrer…' : 'Lagre' }}
    </button>
    <button type="button" class="edit-link-revert" :disabled="saving" @click="revert">Angre</button>
  </footer>
  <div v-if="error" class="edit-save-error">{{ error }}</div>

  <PersonRankHistoryEditor :slug="slug" :entries="history" :targets="historyTargets" />
</template>

<script setup lang="ts">
/**
 * PersonRanksEditor — "Grad" on the Person's Rediger pane
 * (docs/PERSON-RANKS.md R6–R8):
 *
 * - the rank the person is known by (`RANK`) — a picker, saved on its own;
 * - the rank history (`HELD_RANK` entries) — PersonRankHistoryEditor.
 *
 * When the latest open real entry in the history differs from the known
 * rank, a hint offers to use it. The known rank is never derived
 * automatically — a history can be incomplete.
 */
import { computed, ref, watch } from 'vue'
import PersonRankHistoryEditor from './PersonRankHistoryEditor.vue'
import { latestOpen } from '@/components/relation/rankStrategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import type { KnownRank, RankOption } from './types.ts'
import { authFetch } from '@/composables/useAuth.ts'

const props = defineProps<{
  slug:    string
  known:   KnownRank | null
  options: RankOption[]
  /** HELD_RANK entries — mutated in place by the history editor. */
  history: RelationEntry[]
}>()

const emit = defineEmits<{ saved: [rank: KnownRank] }>()

const draftSlug = ref<string | null>(null)
const saving    = ref(false)
const error     = ref<string | null>(null)

watch(() => props.known, k => { draftSlug.value = k?.rankSlug ?? null; error.value = null }, { immediate: true })

const dirty     = computed(() => draftSlug.value !== (props.known?.rankSlug ?? null))
const draftName = computed(() => props.options.find(o => o.slug === draftSlug.value)?.name ?? '—')
const historyTargets = computed<RelationTarget[]>(() => props.options.map(o => ({ slug: o.slug, name: o.name })))

const mismatch = computed(() => {
  const last = latestOpen(props.history, false)
  return last && last.targetSlug !== draftSlug.value ? last : null
})

function revert() {
  draftSlug.value = props.known?.rankSlug ?? null
  error.value = null
}

async function save() {
  const opt = props.options.find(o => o.slug === draftSlug.value)
  if (!opt) return
  saving.value = true
  error.value  = null
  try {
    const res = await authFetch(`/api/admin/person/${encodeURIComponent(props.slug)}/rank`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ rankSlug: opt.slug }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    emit('saved', { rankSlug: opt.slug, rankName: opt.name, tier: opt.tier, state: 'verified', sourceRef: 'admin-edit' })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.edit-section {
  padding: var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}
.edit-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}
.edit-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin: 0;
}
.known-rank-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.known-rank-select { max-width: 280px; }
.known-rank-state {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  color: var(--muted);
}
.known-rank-hint {
  margin: var(--space-sm) 0 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
}
.edit-link {
  background: none;
  border: 0;
  padding: 0;
  margin-left: var(--space-xs);
  font: inherit;
  color: var(--faded-red);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
</style>
