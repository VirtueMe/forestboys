<template>
  <div class="role-form">
    <form class="form-body" @submit.prevent="save">
      <div class="form-heading">{{ createMode ? 'Ny rolle' : 'Rediger rolle' }}</div>

      <div class="form-row">
        <label class="form-label" for="role-name">Navn</label>
        <input id="role-name" v-model="draft.name" class="form-input" type="text" placeholder="f.eks. kurér" />
      </div>

      <div v-if="createMode" class="form-row">
        <label class="form-label" for="role-key">Nøkkel</label>
        <div class="stack">
          <input
            id="role-key"
            v-model="draft.key"
            class="form-input form-input-mono form-input-short"
            :class="`key-${keyState}`"
            type="text"
            placeholder="kebab-case"
            @input="keyEdited = true"
          />
          <span v-if="keyTaken" class="form-hint form-hint--error">Nøkkelen finnes allerede.</span>
          <span v-else class="form-hint">Lagres på koblingene og kan ikke endres senere.</span>
        </div>
      </div>
      <div v-else class="form-row">
        <span class="form-label">Nøkkel</span>
        <code class="key-readonly">{{ role!.key }}</code>
      </div>

      <div class="form-row form-row--top">
        <span class="form-label">Grupper</span>
        <div class="stack">
          <label v-for="s in scopes" :key="s" class="scope-option" :class="{ 'scope-option--locked': lockedScope(s) }">
            <input
              type="checkbox"
              :checked="draft.scopes.includes(s)"
              :disabled="lockedScope(s)"
              @change="toggleScope(s)"
            />
            {{ scopeLabel(s) }}
            <span v-if="usageIn(s)" class="scope-usage">i bruk ({{ usageIn(s) }})</span>
          </label>
        </div>
      </div>

      <div v-if="error" class="form-error">{{ error }}</div>

      <div class="form-actions">
        <button type="button" class="btn-link" :disabled="saving" @click="emit('cancel')">Lukk</button>
        <button type="submit" class="btn-primary" :disabled="saving || !canSave">
          {{ saving ? (createMode ? 'Oppretter…' : 'Lagrer…') : (createMode ? 'Opprett' : 'Lagre') }}
        </button>
      </div>
    </form>

    <!-- Description: its own save bar, like entity pages. Only once the
         role exists — the sections endpoint is keyed by role. -->
    <div v-if="!createMode" class="desc-slot">
      <div v-if="sectionsLoading" class="form-hint">Laster beskrivelse…</div>
      <DescriptionEditor
        v-else
        :saved="savedSections"
        :endpoint="`/api/admin/roles/${encodeURIComponent(role!.key)}/sections`"
        label="Beskrivelse"
        @saved="onSectionsSaved"
      />
    </div>
    <p v-else class="form-hint desc-later">Beskrivelse med kilder kan legges til når rollen er opprettet.</p>
  </div>
</template>

<script setup lang="ts">
/**
 * RoleEditForm — inline create/edit form for a Role on /admin/roles.
 *
 * Scalar part (name, groups; key at create) saves via /api/admin/roles.
 * A group still used by edges can't be unticked (the server refuses it
 * too). The description is a DescriptionEditor with its own save bar,
 * so a role's definition can cite sources like any entity description.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { slugify, SLUG_RE } from '@/utils/slug.ts'
import { scopeLabel } from '@/utils/roleScopes.ts'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import type { Section } from '@/components/SectionsEditor.vue'

export interface RoleRow {
  key:            string
  name:           string
  scopes:         string[]
  usage:          Record<string, number>
  hasDescription: boolean
}

const props = defineProps<{
  /** Absent in create mode. */
  role?:     RoleRow
  /** All scopes the server knows, in display order. */
  scopes:    string[]
  takenKeys: string[]
}>()

const emit = defineEmits<{
  saved:       [role: RoleRow]
  description: [key: string, hasDescription: boolean]
  cancel:      []
}>()

const createMode = computed(() => !props.role)

const draft = ref({
  key:    props.role?.key ?? '',
  name:   props.role?.name ?? '',
  scopes: [...(props.role?.scopes ?? [])],
})
const baseline = { name: draft.value.name, scopes: [...draft.value.scopes] }
const saving    = ref(false)
const error     = ref<string | null>(null)
const keyEdited = ref(false)

watch(() => draft.value.name, (v) => {
  if (createMode.value && !keyEdited.value) draft.value.key = slugify(v)
})

const keyTaken = computed(() => createMode.value && props.takenKeys.includes(draft.value.key.trim()))
const keyState = computed<'neutral' | 'valid' | 'invalid'>(() => {
  const k = draft.value.key.trim()
  if (!k) return 'neutral'
  return SLUG_RE.test(k) && !keyTaken.value ? 'valid' : 'invalid'
})

const usageIn    = (s: string) => props.role?.usage?.[s] ?? 0
const lockedScope = (s: string) => draft.value.scopes.includes(s) && usageIn(s) > 0

function toggleScope(s: string) {
  if (lockedScope(s)) return
  draft.value.scopes = draft.value.scopes.includes(s)
    ? draft.value.scopes.filter(x => x !== s)
    : props.scopes.filter(x => x === s || draft.value.scopes.includes(x))
}

const sameScopes = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join()
const dirty = computed(() =>
  draft.value.name !== baseline.name || !sameScopes(draft.value.scopes, baseline.scopes),
)

const canSave = computed(() => {
  if (!draft.value.name.trim() || !draft.value.scopes.length) return false
  if (createMode.value) return keyState.value === 'valid'
  return dirty.value
})

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value  = null
  const f = draft.value
  try {
    if (createMode.value) {
      const key = f.key.trim()
      const res = await authFetch('/api/admin/roles', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key, name: f.name.trim(), scopes: f.scopes }),
      })
      const out = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { error.value = out.error ?? `HTTP ${res.status}`; return }
      emit('saved', { key, name: f.name.trim(), scopes: [...f.scopes], usage: {}, hasDescription: false })
      return
    }

    const body: Record<string, unknown> = {}
    if (f.name !== baseline.name) body.name = f.name.trim()
    if (!sameScopes(f.scopes, baseline.scopes)) body.scopes = f.scopes
    const res = await authFetch(`/api/admin/roles/${encodeURIComponent(props.role!.key)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as Partial<RoleRow> & { error?: string; blocked?: Record<string, number> }
    if (!res.ok) {
      error.value = out.blocked
        ? `Kan ikke fjerne gruppe som er i bruk: ${Object.entries(out.blocked).map(([s, n]) => `${scopeLabel(s)} (${n})`).join(', ')}`
        : (out.error ?? `HTTP ${res.status}`)
      return
    }
    baseline.name   = out.name ?? f.name.trim()
    baseline.scopes = [...(out.scopes ?? f.scopes)]
    emit('saved', {
      ...props.role!,
      name:   baseline.name,
      scopes: [...baseline.scopes],
      usage:  out.usage ?? props.role!.usage,
    })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

// ── Description ────────────────────────────────────────────────
interface SectionRow {
  order:     number | null
  content:   string | null
  citations: Array<{ inline: boolean | null; sourceId: string | null; sourceTitle: string | null; sourceUrl: string | null; sourceAuthor: string | null }>
  sourcedFrom: { id: string; title: string | null; url: string | null; authorFreeText: string | null; license: string | null; attribution: string | null } | null
}

const savedSections   = ref<Section[]>([])
const sectionsLoading = ref(false)

async function loadSections(key: string) {
  sectionsLoading.value = true
  try {
    const rows = await neo4jQuery<SectionRow>(
      `MATCH (:Role {key: $key})-[:HAS_CONTENT]->(d:Description)
       OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
       WITH d, from
       OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
       WITH d, from,
            collect(CASE WHEN src IS NULL THEN NULL ELSE {
              inline: coalesce(cites.inline, false), sourceId: src.id,
              sourceTitle: src.title, sourceUrl: src.url, sourceAuthor: src.authorFreeText
            } END) AS rawCites
       RETURN coalesce(d.order, 1) AS \`order\`, d.content AS content,
              [x IN rawCites WHERE x IS NOT NULL] AS citations,
              CASE WHEN from IS NULL THEN NULL ELSE {
                id: from.id, title: from.title, url: from.url,
                authorFreeText: from.authorFreeText, license: from.license, attribution: from.attribution
              } END AS sourcedFrom
       ORDER BY \`order\``,
      { key },
    )
    savedSections.value = rows.map(r => ({
      order:   r.order ?? 1,
      content: r.content ?? '[]',
      citations: (r.citations ?? []).filter(c => c.sourceId).map(c => ({
        inline: c.inline ?? false,
        source: { id: c.sourceId!, title: c.sourceTitle, url: c.sourceUrl, authorFreeText: c.sourceAuthor },
      })),
      sourcedFrom: r.sourcedFrom ? { ...r.sourcedFrom } : null,
    }))
  } catch (e) {
    error.value = `Kunne ikke laste beskrivelse: ${(e as Error).message}`
  } finally {
    sectionsLoading.value = false
  }
}
if (props.role) void loadSections(props.role.key)

function onSectionsSaved(sections: Section[]) {
  savedSections.value = sections
  emit('description', props.role!.key, sections.length > 0)
}
</script>

<style scoped>
.role-form {
  padding: var(--space-md);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}
.form-body { display: flex; flex-direction: column; gap: var(--space-sm); }
.form-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: var(--space-xs);
}
.form-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-md);
  align-items: center;
}
.form-row--top { align-items: start; }
.form-label {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
}
.form-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}
.form-input:focus { outline: 1px solid var(--focus); outline-offset: 0; border-color: var(--focus); }
.form-input-short { max-width: 240px; }
.form-input-mono  { font-family: var(--font-mono); font-size: var(--size-mono); }
.form-input.key-valid   { color: var(--moss);   border-color: var(--moss); }
.form-input.key-invalid { color: var(--danger); border-color: var(--danger); }
.key-readonly { font-family: var(--font-mono); font-size: var(--size-mono); color: var(--ink-soft); }

.stack { display: flex; flex-direction: column; gap: var(--space-xs); }
.form-hint { font-family: var(--font-sans); font-size: var(--size-label); color: var(--muted); }
.form-hint--error { color: var(--danger); }

.scope-option {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  cursor: pointer;
}
.scope-option--locked { cursor: not-allowed; }
.scope-usage { font-size: var(--size-label); color: var(--muted); }

.form-error {
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-md);
  margin-top: var(--space-xs);
}
.btn-primary {
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
.btn-primary:hover:not(:disabled) { background: var(--faded-red-soft); }
.btn-primary:disabled { background: var(--paper-sunken); color: var(--muted); cursor: not-allowed; }
.btn-link {
  background: transparent;
  border: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  cursor: pointer;
}
.btn-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

.desc-slot { margin-top: var(--space-md); padding-top: var(--space-md); border-top: 1px solid var(--rule); }
.desc-later { margin: var(--space-md) 0 0; }

@media (max-width: 520px) { .form-row { grid-template-columns: 1fr; gap: var(--space-xs); } }
</style>
