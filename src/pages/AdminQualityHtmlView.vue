<template>
  <div class="quality-html">
    <header class="header">
      <h1 class="title">Feil i beskrivelsenes oppbygning</h1>
      <p class="lede">
        Beskrivelser der selve oppbyggingen er ødelagt: tomme overskrifter, overskrifter som bryter
        strukturen, hopp i listenivå, merker uten definisjon og skrevet markup. Listen viser; rettingen
        gjøres i editoren på siden. Den regnes ut på nytt hver gang, og en rad forsvinner herfra når den er rettet.
      </p>
    </header>

    <div v-if="loading" class="status">Sjekker beskrivelsene…</div>
    <div v-else-if="error" class="status error">{{ error }}</div>
    <template v-else>
      <p class="meta">{{ rows.length }} funn i {{ scanned }} beskrivelser</p>

      <div class="filters">
        <div class="chips" role="group" aria-label="Filtrer på type feil">
          <button
            v-for="k in KINDS"
            :key="k.key"
            type="button"
            class="chip"
            :class="{ active: kindFilter === k.key }"
            :aria-pressed="kindFilter === k.key"
            @click="kindFilter = kindFilter === k.key ? null : k.key"
          >
            {{ k.label }} <span class="chip-count">{{ counts[k.key] ?? 0 }}</span>
          </button>
        </div>
        <select v-model="kind" class="kind-select" aria-label="Filtrer på sidetype">
          <option value="">Alle sidetyper</option>
          <option v-for="k in kinds" :key="k" :value="k">{{ kindLabel(k) }}</option>
        </select>
      </div>

      <p v-if="!shown.length" class="status">
        {{ rows.length ? 'Ingen funn med dette filteret.' : 'Ingen feil å se på.' }}
      </p>
      <ul v-else class="list">
        <li v-for="(r, i) in shown" :key="`${r.descId}:${r.blockKey}:${r.kind}:${i}`" class="row">
          <div class="row-head">
            <RouterLink v-if="r.path" :to="r.path" class="row-title">{{ r.name }}</RouterLink>
            <span v-else class="row-title">{{ r.name }}</span>
            <span class="row-kind">{{ kindLabel(r.label) }}</span>
            <span class="badge" :class="{ 'badge-shows': SHOWS.has(r.kind) }">{{ KIND_LABEL[r.kind] }}</span>
          </div>
          <div v-if="r.text" class="row-text"><q>{{ r.text }}</q></div>
          <div class="row-detail">{{ r.detail }}</div>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import type { BlockKind } from '@/utils/blockCheck.ts'

interface Row {
  kind:     BlockKind
  blockKey: string
  text:     string
  detail:   string
  label:    string
  slug:     string | null
  name:     string
  path:     string | null
  descId:   string
}

// What shows on the page comes first, then what is only untidy (the order of functions/_lib/block-audit.ts).
const KINDS: { key: BlockKind; label: string }[] = [
  { key: 'empty-heading',     label: 'Tom overskrift' },
  { key: 'heading-outline',   label: 'Overskriftsnivå' },
  { key: 'typed-markup',      label: 'Skrevet markup' },
  { key: 'dangling-mark',     label: 'Merke uten definisjon' },
  { key: 'list-level-jump',   label: 'Hopp i listenivå' },
  { key: 'stray-list-level',  label: 'Nivå uten liste' },
  { key: 'unused-definition', label: 'Ubrukt definisjon' },
]
const KIND_LABEL: Record<BlockKind, string> = Object.fromEntries(KINDS.map(k => [k.key, k.label])) as Record<BlockKind, string>
/** The ones a reader of the page can see; the rest are cleanup. */
const SHOWS = new Set<BlockKind>(['empty-heading', 'heading-outline', 'typed-markup'])

const SIDE_LABEL: Record<string, string> = {
  Operation: 'Operasjon', Incident: 'Hendelse', Person: 'Person', Location: 'Sted',
  Transport: 'Fremkomstmiddel', Station: 'Stasjon', Outline: 'Informasjon',
  Organization: 'Organisasjon', EquipmentType: 'Utstyr', Card: 'Sidekort',
}
const kindLabel = (k: string) => SIDE_LABEL[k] ?? k

const rows       = ref<Row[]>([])
const scanned    = ref(0)
const loading    = ref(true)
const error      = ref<string | null>(null)
const kindFilter = ref<BlockKind | null>(null)
const kind       = ref('')

const counts = computed(() => {
  const c: Partial<Record<BlockKind, number>> = {}
  for (const r of rows.value) c[r.kind] = (c[r.kind] ?? 0) + 1
  return c
})
const kinds = computed(() => [...new Set(rows.value.map(r => r.label))].sort())
const shown = computed(() => rows.value.filter(r =>
  (!kindFilter.value || r.kind === kindFilter.value) && (!kind.value || r.label === kind.value)))

async function load() {
  try {
    const res = await authFetch('/api/admin/quality/html')
    const body = await res.json() as { rows?: Row[]; scanned?: number; error?: string }
    if (!res.ok) { error.value = body.error ?? `HTTP ${res.status}`; return }
    rows.value    = body.rows ?? []
    scanned.value = body.scanned ?? 0
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
void load()
</script>

<style scoped>
.quality-html {
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
.badge-shows { color: var(--faded-red); border-color: var(--faded-red-soft); }

.row-text   { font-size: 13px; color: var(--ink-soft); overflow-wrap: anywhere; }
.row-detail { font-size: 13px; color: var(--ink-soft); overflow-wrap: anywhere; }

@media (max-width: 600px) {
  .quality-html { padding: 16px; }
}
</style>
