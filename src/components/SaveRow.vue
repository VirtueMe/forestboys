<template>
  <div v-if="registry && rows.length" class="save-row" :class="{ open }" data-testid="save-row">
    <div
      v-if="open"
      id="save-row-list"
      class="save-list"
      role="region"
      aria-label="Ulagrede endringer"
    >
      <ul>
        <li v-for="r in rows" :key="r.id" class="save-item" :class="`is-${r.state}`">
          <div class="save-item-main">
            <span class="save-item-label">{{ r.label }}</span>
            <span class="save-item-state" aria-live="polite">{{ r.stateText }}</span>
            <span class="save-item-actions">
              <button
                v-if="r.state === 'failed'"
                type="button"
                class="save-link"
                @click="registry.saveOne(r.id)"
              >Prøv igjen</button>
              <button
                v-if="r.canRevert"
                type="button"
                class="save-link"
                @click="registry.revert(r.id)"
              >Angre</button>
            </span>
          </div>
          <p v-if="r.error" class="save-item-error">{{ r.error }}</p>
        </li>
      </ul>
    </div>

    <div class="save-bar">
      <button
        type="button"
        class="save-summary"
        :aria-expanded="open"
        aria-controls="save-row-list"
        @click="open = !open"
      >
        <span class="save-chevron" aria-hidden="true">{{ open ? '▾' : '▴' }}</span>
        <span class="save-summary-text" aria-live="polite">{{ summary }}</span>
      </button>
      <button
        v-if="!allDone"
        type="button"
        class="edit-btn-primary"
        :disabled="registry.saving.value || !registry.dirtyCount.value"
        @click="saveAll"
      >
        Lagre alt
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * SaveRow — the one save row for a page in edit mode (#427).
 *
 * Sticks to the bottom of the page's scroll container (DetailPage), so it never
 * hides the end of the page: it takes its own room below the content. It shows
 * how many sections have unsaved changes and «Lagre alt»; the drop-up lists the
 * sections with their state and a per-section «Angre». Reads the registry the
 * page provides; renders nothing when no editor has anything to report.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useSaveRegistry } from '@/composables/useSaveRegistry.ts'

const registry = useSaveRegistry()
const open     = ref(false)
const now      = ref(Date.now())

let ticker: ReturnType<typeof setInterval> | null = null
function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null } }
onBeforeUnmount(stopTicker)

interface Row {
  id:        string
  label:     string
  state:     'idle' | 'waiting' | 'working' | 'done' | 'failed'
  stateText: string
  error:     string | null
  canRevert: boolean
}

const rows = computed<Row[]>(() => {
  const r = registry
  if (!r) return []
  return r.listed.value.map(s => {
    const st = r.statusOf(s.id)
    // A section that was saved and then edited again is unsaved, not «Lagret».
    const state = st.state === 'done' && s.dirty() ? 'idle' : st.state
    let stateText = ''
    if (state === 'waiting') stateText = 'Venter'
    else if (state === 'working') stateText = `Lagrer… ${Math.max(0, Math.floor((now.value - (st.startedAt ?? now.value)) / 1000))} s`
    else if (state === 'done') stateText = 'Lagret'
    else if (state === 'failed') stateText = 'Kunne ikke lagres'
    return {
      id: s.id,
      label: s.label,
      state,
      stateText,
      error: state === 'failed' ? st.error : null,
      canRevert: state === 'idle' || state === 'failed',
    }
  })
})

const allDone = computed(() => rows.value.length > 0 && rows.value.every(r => r.state === 'done'))

const summary = computed(() => {
  const r = registry
  if (!r) return ''
  if (r.saving.value) return 'Lagrer…'
  if (allDone.value) return 'Alt er lagret'
  if (r.failedCount.value) {
    const n = r.failedCount.value
    return n === 1 ? '1 seksjon kunne ikke lagres' : `${n} seksjoner kunne ikke lagres`
  }
  const n = r.dirtyCount.value
  return n === 1 ? '1 seksjon har ulagrede endringer' : `${n} seksjoner har ulagrede endringer`
})

function saveAll() {
  open.value = true
  void registry?.saveAll()
}

// A tick for the per-section timer, only while something is saving.
watch(() => registry?.saving.value, (busy) => {
  stopTicker()
  if (busy) {
    now.value = Date.now()
    ticker = setInterval(() => { now.value = Date.now() }, 500)
  }
}, { immediate: true })

// The list stays open for a failure; once everything is saved say so, then empty it.
let clearTimer: ReturnType<typeof setTimeout> | null = null
watch(allDone, (done) => {
  if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
  if (!done) return
  clearTimer = setTimeout(() => { registry?.dismissDone(); open.value = false }, 2500)
})
onBeforeUnmount(() => { if (clearTimer) clearTimeout(clearTimer) })

// Nothing left to show: close the drop-up so it is not open on the next edit.
watch(() => rows.value.length, (n) => { if (n === 0) open.value = false })
</script>

<style scoped>
.save-row {
  position: sticky;
  bottom: 0;
  z-index: 5;
  flex-shrink: 0;
  margin-top: var(--space-lg);
  background: var(--paper-raised);
  border-top: 1px solid var(--rule);
  box-shadow: var(--shadow-md);
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.save-bar {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
}

.save-summary {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: 44px;
  padding: 0;
  background: transparent;
  border: none;
  text-align: left;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  color: var(--ink-soft);
  cursor: pointer;
}
.save-chevron { color: var(--muted); }

/* the drop-up opens above the bar, inside the same sticky box */
.save-list {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  max-height: 50vh;
  overflow-y: auto;
  background: var(--paper-raised);
  border-top: 1px solid var(--rule);
  box-shadow: var(--shadow-md);
}
.save-list ul { list-style: none; margin: 0; padding: 0; }

.save-item { padding: var(--space-sm) var(--space-md); border-top: 1px solid var(--rule); }
.save-item:first-child { border-top: none; }
.save-item-main { display: flex; align-items: baseline; gap: var(--space-md); flex-wrap: wrap; }
.save-item-label {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  color: var(--ink);
}
.save-item-state {
  flex: 1;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
}
.save-item.is-failed .save-item-state { color: var(--danger); }
.save-item-actions { display: flex; gap: var(--space-md); }
.save-item-error {
  margin: var(--space-xs) 0 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}

.save-link {
  background: transparent;
  border: none;
  padding: var(--space-xs) 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  cursor: pointer;
}
.save-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

.edit-btn-primary {
  min-height: 44px;
  padding: var(--space-sm) var(--space-lg);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  background: var(--faded-red);
  color: var(--paper);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.edit-btn-primary:hover:not(:disabled) { background: var(--faded-red-soft); }
.edit-btn-primary:disabled { background: var(--paper); color: var(--muted); cursor: not-allowed; }
</style>
