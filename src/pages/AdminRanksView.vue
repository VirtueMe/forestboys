<template>
  <div class="admin-ranks">
    <header class="header">
      <h1 class="title">Grader</h1>
      <button v-if="!creating" type="button" class="btn-ghost" @click="startCreate">+ Ny grad</button>
    </header>

    <div v-if="creating" class="create-slot">
      <RankEditForm
        :branches="branches"
        :country-codes="countryCodes"
        :taken-slugs="ranks.map(r => r.slug)"
        @saved="onCreated"
        @cancel="creating = false"
      />
    </div>

    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="error" class="status error">{{ error }}</div>
    <template v-else>
      <section v-for="group in groups" :key="group.key" class="group">
        <h2 class="group-heading">{{ group.label }}</h2>
        <ul class="list">
          <li v-for="r in group.ranks" :key="r.slug" class="row">
            <div class="row-main">
              <span class="row-tier" :title="`Nivå ${r.tier ?? '–'}`">{{ r.tier ?? '–' }}</span>
              <span class="row-name">{{ r.name }}</span>
              <span v-if="r.abbreviation && r.abbreviation !== r.name" class="row-abbr">{{ r.abbreviation }}</span>
              <span v-for="c in r.countries ?? []" :key="c" class="row-country" title="Land">{{ c }}</span>
              <span class="row-usage" :title="`${r.holders} personer har denne graden`">{{ r.holders }} personer</span>
            </div>
            <div class="row-actions">
              <button type="button" class="btn-ghost" @click="toggleEdit(r.slug)">Rediger</button>
              <button
                type="button"
                class="btn-delete"
                :disabled="r.holders > 0 || deletingSlug === r.slug"
                :title="r.holders > 0 ? 'Graden brukes og kan ikke slettes' : 'Slett'"
                @click="confirmDelete(r)"
              >
                {{ deletingSlug === r.slug ? 'Sletter…' : 'Slett' }}
              </button>
            </div>
            <div v-if="editingSlug === r.slug" class="row-edit">
              <RankEditForm
                :rank="r"
                :branches="branches"
                :country-codes="countryCodes"
                :taken-slugs="[]"
                @saved="onSaved"
                @cancel="editingSlug = null"
              />
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * AdminRanksView — /admin/ranks. The Rank lookup table: grouped by
 * service branch ((:Rank)-[:IN]->(:Organization)), sorted by tier.
 * Countries are the rank's own list (`countries`), independent of branch.
 * Inline create / edit via RankEditForm; delete only when no Person
 * holds the rank. Reads via neo4jQuery, writes via /api/admin/ranks.
 */
import { ref, computed } from 'vue'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { authFetch } from '@/composables/useAuth.ts'
import RankEditForm, { type RankRow, type BranchOption } from '@/components/rank/RankEditForm.vue'

interface Row extends RankRow { holders: number }

const ranks        = ref<Row[]>([])
const branches     = ref<BranchOption[]>([])
const countryCodes = ref<string[]>([])
const loading      = ref(true)
const error        = ref<string | null>(null)
const creating     = ref(false)
const editingSlug  = ref<string | null>(null)
const deletingSlug = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value   = null
  try {
    const [rankRows, orgRows, codeRows] = await Promise.all([
      neo4jQuery<Row>(
        `MATCH (r:Rank)
         OPTIONAL MATCH (r)-[:IN]->(b:Organization)
         OPTIONAL MATCH (:Person)-[h:HELD_RANK]->(r)
         RETURN r.slug AS slug, r.canonicalName AS name, r.abbreviation AS abbreviation,
                r.tier AS tier, r.countries AS countries,
                b.slug AS branchSlug, count(h) AS holders`,
      ),
      // Branch candidates: top-level organizations (Hæren, RAF, Marinen, …).
      neo4jQuery<BranchOption>(
        `MATCH (o:Organization)
         WHERE NOT (o)-[:PART_OF]->(:Organization) AND o.slug IS NOT NULL
         RETURN o.slug AS slug, o.canonicalName AS name
         ORDER BY name`,
      ),
      // Country-code suggestions: every two-letter code already in use.
      neo4jQuery<{ code: string }>(
        `MATCH (n) WHERE n.country IS NOT NULL OR n.countries IS NOT NULL
         UNWIND coalesce(n.countries, [n.country]) AS code
         WITH DISTINCT code WHERE code =~ '[A-Z]{2}'
         RETURN code ORDER BY code`,
      ),
    ])
    ranks.value         = rankRows
    branches.value      = orgRows
    countryCodes.value  = codeRows.map(r => r.code)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
void load()

const branchOf = (slug: string) => branches.value.find(b => b.slug === slug)

const groups = computed(() => {
  const by = new Map<string, Row[]>()
  for (const r of ranks.value) {
    const k = r.branchSlug ?? ''
    if (!by.has(k)) by.set(k, [])
    by.get(k)!.push(r)
  }
  return [...by.entries()]
    .map(([key, rs]) => ({
      key,
      label: key ? (branchOf(key)?.name ?? key) : 'Uten gren',
      ranks: rs.sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || a.name.localeCompare(b.name, 'nb')),
    }))
    // Largest branch first; "Uten gren" last.
    .sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || b.ranks.length - a.ranks.length)
})

function startCreate() {
  editingSlug.value = null
  creating.value    = true
}

function toggleEdit(slug: string) {
  creating.value    = false
  editingSlug.value = editingSlug.value === slug ? null : slug
}

function onCreated(r: RankRow) {
  ranks.value.push({ ...r, holders: 0 })
  creating.value = false
}

function onSaved(r: RankRow) {
  const row = ranks.value.find(x => x.slug === r.slug)
  if (row) Object.assign(row, r)
  editingSlug.value = null
}

async function confirmDelete(r: Row) {
  if (r.holders > 0) return
  if (!window.confirm(`Slett graden «${r.name}»?`)) return
  deletingSlug.value = r.slug
  try {
    const res = await authFetch(`/api/admin/ranks/${encodeURIComponent(r.slug)}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      error.value = body.error ?? `HTTP ${res.status}`
      return
    }
    ranks.value = ranks.value.filter(x => x.slug !== r.slug)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    deletingSlug.value = null
  }
}
</script>

<style scoped>
.admin-ranks {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--paper);
  padding: var(--space-lg);
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}
.title {
  font-size: 24px;
  font-weight: 700;
  color: var(--focus);
  margin: 0;
}

.create-slot { margin-bottom: var(--space-lg); }

.status { padding: var(--space-lg); font-size: var(--size-label); color: var(--muted); text-align: center; }
.error  { color: var(--danger); }

.group + .group { margin-top: var(--space-lg); }
.group-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 var(--space-sm);
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-md);
  padding: 10px 14px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}
.row-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.row-tier {
  width: 22px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.row-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.row-abbr {
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  color: var(--ink-soft);
}
.row-country {
  padding: 0 5px;
  border: 1px solid var(--rule);
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
}
.row-usage {
  font-size: 11px;
  color: var(--muted);
  padding: 1px 6px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 8px;
}

.row-actions { display: flex; gap: 6px; align-self: flex-start; }
.btn-ghost,
.btn-delete {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink);
  font-family: inherit;
}
.btn-ghost:hover { border-color: var(--focus); color: var(--focus); }
.btn-delete { color: var(--danger); }
.btn-delete:hover:not(:disabled) { border-color: var(--danger); }
.btn-delete:disabled { opacity: 0.4; cursor: not-allowed; }

.row-edit { grid-column: 1 / -1; }
</style>
