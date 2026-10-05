<template>
  <div class="quality-links">
    <header class="header">
      <h1 class="title">Lenker som ikke fungerer</h1>
      <p class="lede">
        Lenker i beskrivelser som peker til en side som ikke finnes, eller som er skrevet
        annerledes enn siden de mener. Listen regnes ut på nytt hver gang; en lenke
        forsvinner herfra når den er rettet.
      </p>
    </header>

    <div v-if="loading" class="status">Sjekker beskrivelsene…</div>
    <div v-else-if="error" class="status error">{{ error }}</div>
    <template v-else>
      <p class="meta">
        {{ rows.length }} lenker å se på · {{ checked }} lenker sjekket i {{ scanned }} beskrivelser
      </p>

      <div class="filters">
        <div class="chips" role="group" aria-label="Filtrer på type">
          <button
            v-for="v in VERDICTS"
            :key="v.key"
            type="button"
            class="chip"
            :class="{ active: verdict === v.key }"
            :aria-pressed="verdict === v.key"
            @click="verdict = verdict === v.key ? null : v.key"
          >
            {{ v.label }} <span class="chip-count">{{ counts[v.key] ?? 0 }}</span>
          </button>
        </div>
        <select v-model="kind" class="kind-select" aria-label="Filtrer på sidetype">
          <option value="">Alle sidetyper</option>
          <option v-for="k in kinds" :key="k" :value="k">{{ kindLabel(k) }}</option>
        </select>
      </div>

      <p v-if="!shown.length" class="status">
        {{ rows.length ? 'Ingen lenker med dette filteret.' : 'Ingen lenker å se på.' }}
      </p>
      <ul v-else class="list">
        <li v-for="r in shown" :key="`${r.descId}:${r.blockKey}:${r.markKey}`" class="row">
          <div class="row-head">
            <RouterLink v-if="r.path" :to="r.path" class="row-title">{{ r.name }}</RouterLink>
            <span v-else class="row-title">{{ r.name }}</span>
            <span class="row-kind">{{ kindLabel(r.label) }}</span>
            <span class="badge" :class="`badge-${r.verdict}`">{{ VERDICT_LABEL[r.verdict] }}</span>
          </div>
          <div class="row-link">
            Teksten <q>{{ r.text }}</q>
            <template v-if="r.verdict === 'empty'"> har ingen mål.</template>
            <template v-else> peker til <code>{{ r.stored.trim() }}</code></template>
          </div>
          <div v-if="r.suggestion" class="row-hint">
            Skal trolig peke til
            <RouterLink :to="r.suggestion.path">{{ r.suggestion.slug }}</RouterLink>
            ({{ kindLabel(r.suggestion.label) }}).
          </div>
          <div v-else-if="r.candidates" class="row-hint">
            Passer like godt med
            <template v-for="(c, i) in r.candidates" :key="c.path">
              <RouterLink :to="c.path">{{ c.slug }}</RouterLink>{{ i < r.candidates.length - 1 ? ', ' : '.' }}
            </template>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'

type Verdict = 'fixable' | 'ambiguous' | 'broken' | 'empty'

interface Hit { path: string; label: string; slug: string }
interface Row {
  blockKey:    string
  markKey:     string
  text:        string
  stored:      string
  verdict:     Verdict
  suggestion?: Hit
  candidates?: Hit[]
  label:       string
  slug:        string | null
  name:        string
  path:        string | null
  descId:      string
}

const VERDICTS: { key: Verdict; label: string }[] = [
  { key: 'broken',    label: 'Finnes ikke' },
  { key: 'empty',     label: 'Mangler mål' },
  { key: 'ambiguous', label: 'Flere treff' },
  { key: 'fixable',   label: 'Kan rettes' },
]
const VERDICT_LABEL: Record<Verdict, string> = Object.fromEntries(VERDICTS.map(v => [v.key, v.label])) as Record<Verdict, string>

const KIND_LABEL: Record<string, string> = {
  Operation: 'Operasjon', Incident: 'Hendelse', Person: 'Person', Location: 'Sted',
  Transport: 'Fremkomstmiddel', Station: 'Stasjon', Outline: 'Informasjon',
  Organization: 'Organisasjon', EquipmentType: 'Utstyr', Card: 'Sidekort',
}
const kindLabel = (k: string) => KIND_LABEL[k] ?? k

const rows    = ref<Row[]>([])
const scanned = ref(0)
const checked = ref(0)
const loading = ref(true)
const error   = ref<string | null>(null)
const verdict = ref<Verdict | null>(null)
const kind    = ref('')

const counts = computed(() => {
  const c: Partial<Record<Verdict, number>> = {}
  for (const r of rows.value) c[r.verdict] = (c[r.verdict] ?? 0) + 1
  return c
})
const kinds = computed(() => [...new Set(rows.value.map(r => r.label))].sort())
const shown = computed(() => rows.value.filter(r =>
  (!verdict.value || r.verdict === verdict.value) && (!kind.value || r.label === kind.value)))

async function load() {
  try {
    const res = await authFetch('/api/admin/quality/links')
    const body = await res.json() as { rows?: Row[]; scanned?: number; checked?: number; error?: string }
    if (!res.ok) { error.value = body.error ?? `HTTP ${res.status}`; return }
    rows.value    = body.rows ?? []
    scanned.value = body.scanned ?? 0
    checked.value = body.checked ?? 0
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
void load()
</script>

<style scoped>
.quality-links {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--paper);
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.header { margin-bottom: 16px; }
.title  { font-size: 24px; font-weight: 700; color: var(--focus); margin: 0 0 6px; }
.lede   { margin: 0; font-size: 14px; line-height: 1.5; color: var(--ink-soft); max-width: 60ch; }

.status { padding: 24px; font-size: 13px; color: var(--muted); text-align: center; }
.error  { color: var(--faded-red); }

.meta {
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
}

.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
.chips   { display: flex; flex-wrap: wrap; gap: 6px; }

.chip {
  font: inherit;
  font-size: 13px;
  padding: 6px 12px;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 16px;
  cursor: pointer;
}
.chip.active { color: var(--paper-raised); background: var(--focus); border-color: var(--focus); }
.chip:focus-visible, .kind-select:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.chip-count { opacity: 0.7; margin-left: 2px; }

.kind-select {
  font: inherit;
  font-size: 13px;
  padding: 6px 10px;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 6px;
}

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }

.row {
  padding: 12px 14px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.row-title { font-size: 14px; font-weight: 600; color: var(--ink); }
a.row-title { text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 3px; }
a.row-title:hover { color: var(--focus); text-decoration-color: var(--focus); }
.row-kind {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 8px;
  border: 1px solid var(--rule);
  color: var(--ink-soft);
}
.badge-broken { color: var(--faded-red); border-color: var(--faded-red-soft); }

.row-link { font-size: 13px; color: var(--ink-soft); overflow-wrap: anywhere; }
.row-link code { font-size: 12px; padding: 1px 4px; background: var(--paper); border-radius: 3px; }
.row-hint { font-size: 13px; color: var(--ink-soft); }
.row-hint a { color: var(--focus); }

@media (max-width: 600px) {
  .quality-links { padding: 16px; }
}
</style>
