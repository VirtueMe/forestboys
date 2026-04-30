<template>
  <section class="edit-section">
    <div class="edit-section-head">
      <h3 class="edit-section-heading">{{ label }}</h3>
      <button type="button" class="edit-btn-outline" @click="addEntry">{{ addLabel }}</button>
    </div>
    <div v-if="!entries.length" class="edit-empty">{{ emptyLabel }}</div>
    <ul v-else class="membership-list">
      <li
        v-for="(e, i) in entries"
        :key="i"
        class="membership-item"
        :class="{ expanded: expandedIndex === i }"
      >
        <button
          type="button"
          class="membership-summary"
          :aria-expanded="expandedIndex === i"
          @click="toggleIndex(i)"
        >
          <span class="membership-unit-name">{{ e.targetName || e.targetSlug || '—' }}</span>
          <span v-if="summaryOf(e)" class="membership-meta">{{ summaryOf(e) }}</span>
          <span
            v-if="e.sections.length"
            class="desc-marker"
            aria-label="Har beskrivelse"
            title="Har beskrivelse"
          >i</span>
          <span class="membership-chevron">{{ expandedIndex === i ? '▾' : '▸' }}</span>
        </button>
        <div v-if="expandedIndex === i" class="membership-body">
          <div :class="showRole ? 'membership-edit-top' : 'attendance-edit-top'">
            <div class="unit-picker">
              <div v-if="e.targetSlug" class="unit-chip">
                <span class="unit-chip-name">{{ e.targetName || e.targetSlug }}</span>
                <button
                  type="button"
                  class="unit-chip-clear"
                  :aria-label="pickerChipAria"
                  @click="clearTarget(e)"
                >
                  ✕
                </button>
              </div>
              <template v-else>
                <input
                  v-model="pickerQuery"
                  class="edit-input"
                  :class="{ 'edit-input-invalid': !e.targetSlug }"
                  type="text"
                  :placeholder="searchPlaceholder"
                  @focus="pickerOpen = true"
                  @blur="onPickerBlur"
                />
                <div v-if="pickerOpen && (filteredTargets.length || createHref)" class="unit-results">
                  <button
                    v-for="opt in filteredTargets"
                    :key="opt.slug"
                    type="button"
                    class="unit-result"
                    @mousedown.prevent="pickTarget(e, opt)"
                  >
                    {{ opt.name }}
                  </button>
                  <a
                    v-if="createHref"
                    :href="createHref"
                    class="unit-result unit-result--create"
                  >{{ createLabel || '+ Opprett ny' }}</a>
                </div>
              </template>
            </div>
            <select
              v-if="showRole && roleOptions"
              v-model="e.role"
              class="edit-input membership-role"
            >
              <option :value="null">—</option>
              <option v-for="(roleName, value) in roleOptions" :key="value" :value="value">{{ roleName }}</option>
            </select>
            <button type="button" class="rank-remove-btn" @click="removeEntry(i)">Fjern</button>
          </div>
          <div v-if="showDates" class="membership-edit-dates">
            <input
              class="edit-input edit-input-date"
              type="text"
              placeholder="Startdato"
              :value="e.startDate ?? ''"
              @input="e.startDate = ($event.target as HTMLInputElement).value || null"
            />
            <span class="rank-dash">–</span>
            <input
              class="edit-input edit-input-date"
              type="text"
              placeholder="Sluttdato"
              :value="e.endDate ?? ''"
              @input="e.endDate = ($event.target as HTMLInputElement).value || null"
            />
          </div>
          <div v-if="showPassed" class="passed-seg">
            <label class="passed-seg-opt" :class="{ active: e.passed === null || e.passed === undefined }">
              <input type="radio" :value="null" :checked="e.passed === null || e.passed === undefined" @change="e.passed = null" />
              Ukjent
            </label>
            <label class="passed-seg-opt" :class="{ active: e.passed === true }">
              <input type="radio" :value="true" :checked="e.passed === true" @change="e.passed = true" />
              Bestått
            </label>
            <label class="passed-seg-opt" :class="{ active: e.passed === false }">
              <input type="radio" :value="false" :checked="e.passed === false" @change="e.passed = false" />
              Ikke bestått
            </label>
          </div>
          <slot name="extra-fields" :entry="e"></slot>
          <div v-if="showDescription" class="membership-desc-wrap">
            <label class="membership-desc-label">Beskrivelse</label>
            <SectionsEditor :sections="e.sections" />
          </div>
        </div>
      </li>
    </ul>
  </section>

  <footer v-if="dirty" class="edit-save-bar">
    <span class="edit-save-prompt">
      {{ valid ? 'Ser det bra ut?' : validationEmpty }}
    </span>
    <button
      type="button"
      class="edit-btn-primary"
      :disabled="saving || !valid"
      @click="save"
    >
      {{ saving ? 'Lagrer…' : 'Lagre' }}
    </button>
    <button type="button" class="edit-link-revert" :disabled="saving" @click="revert">Angre</button>
  </footer>
  <div v-if="error" class="edit-save-error">{{ error }}</div>
</template>

<script setup lang="ts">
// Parent owns the `entries` array (reactive). Editor mutates in place.
/* eslint-disable vue/no-mutating-props */
import { computed, ref, watch } from 'vue'
import SectionsEditor, { type Section } from '@/components/SectionsEditor.vue'
import type { RelationEntry, RelationStrategy, RelationTarget } from './RelationStrategy.ts'

const props = withDefaults(defineProps<{
  parentSlug: string
  entries:    RelationEntry[]
  targets:    RelationTarget[]
  strategy:   RelationStrategy

  label:             string
  addLabel:          string
  emptyLabel:        string
  searchPlaceholder: string
  pickerChipAria:    string
  validationEmpty:   string

  showRole?:        boolean
  showDates?:       boolean
  showPassed?:      boolean
  showDescription?: boolean
  roleOptions?:     Record<string, string>
  defaultRole?:     string | null
  /** Optional "create new" button at the bottom of the typeahead dropdown. */
  createLabel?:     string
  createHref?:      string
  /** Auto-expand the row whose targetSlug matches this on mount / prop change. */
  expandSlug?:      string | null
  /** Optional signature contribution for dirty tracking when the caller
   *  mutates per-entry fields via the `extra-fields` slot. Return any string
   *  that changes when the caller's fields change. */
  signatureExtra?:  ((e: RelationEntry) => string) | null
  /** Optional summary contribution shown in the row header. */
  summaryExtra?:    ((e: RelationEntry) => string) | null
}>(), {
  showRole:        false,
  showDates:       true,
  showPassed:      false,
  showDescription: true,
  roleOptions:     undefined,
  defaultRole:     null,
  createLabel:     undefined,
  createHref:      undefined,
  expandSlug:      null,
  signatureExtra:  null,
  summaryExtra:    null,
})

const emit = defineEmits<{ saved: [] }>()

const expandedIndex = ref<number | null>(null)
const pickerQuery   = ref('')
const pickerOpen    = ref(false)
const saving        = ref(false)
const error         = ref<string | null>(null)

function cloneSection(s: Section): Section {
  return {
    ...s,
    citations:   s.citations.map(c => ({ ...c, source: { ...c.source } })),
    sourcedFrom: s.sourcedFrom ? { ...s.sourcedFrom } : null,
  }
}

function cloneEntry(e: RelationEntry): RelationEntry {
  return { ...e, sections: e.sections.map(cloneSection) }
}

function sectionsSignature(sections: Section[]): string {
  return JSON.stringify(
    [...sections].sort((a, b) => a.order - b.order).map(s => [
      s.order, s.content,
      s.citations.map(c => [c.inline, c.source.id]),
      s.sourcedFrom?.id ?? null,
    ]),
  )
}

function entrySignature(arr: RelationEntry[]): string {
  return JSON.stringify(
    arr.map(e => [
      e.targetSlug, e.role ?? null, e.passed ?? null,
      e.startDate, e.endDate, sectionsSignature(e.sections),
      props.signatureExtra ? props.signatureExtra(e) : '',
    ]),
  )
}

const originalEntries = ref<RelationEntry[]>([])

function snapshot() {
  originalEntries.value = props.entries.map(cloneEntry)
}

watch(() => props.entries, snapshot, { immediate: true })

// Auto-expand a specific row when the parent passes expandSlug.
watch([() => props.expandSlug, () => props.entries], ([slug]) => {
  if (!slug) return
  const idx = props.entries.findIndex(e => e.targetSlug === slug)
  if (idx >= 0) expandedIndex.value = idx
}, { immediate: true })

const dirty = computed(() => entrySignature(props.entries) !== entrySignature(originalEntries.value))
const valid = computed(() => props.entries.every(e => e.targetSlug.trim().length > 0))

const filteredTargets = computed(() => {
  const q = pickerQuery.value.trim().toLowerCase()
  if (!q) return props.targets.slice(0, 12)
  return props.targets.filter(t => t.name.toLowerCase().includes(q)).slice(0, 20)
})

function toggleIndex(i: number) {
  expandedIndex.value = expandedIndex.value === i ? null : i
  pickerQuery.value = ''
  pickerOpen.value = false
}

function onPickerBlur() {
  window.setTimeout(() => { pickerOpen.value = false }, 150)
}

function pickTarget(entry: RelationEntry, opt: RelationTarget) {
  entry.targetSlug = opt.slug
  entry.targetName = opt.name
  pickerQuery.value = ''
  pickerOpen.value = false
}

function clearTarget(entry: RelationEntry) {
  entry.targetSlug = ''
  entry.targetName = ''
}

function addEntry() {
  props.entries.push({
    targetSlug:     '',
    targetName:     '',
    startDate:      null,
    endDate:        null,
    role:           props.showRole   ? (props.defaultRole ?? null) : undefined,
    passed:         props.showPassed ? null                         : undefined,
    sections:       [],
    hasDescription: false,
  })
  expandedIndex.value = props.entries.length - 1
}

function removeEntry(i: number) {
  const e = props.entries[i]
  if (!e) return
  const name = e.targetName || e.targetSlug || 'denne oppføringen'
  const msg = e.sections.length
    ? `Fjerne ${name}? Beskrivelsen forsvinner også når du lagrer.`
    : `Fjerne ${name}?`
  if (!window.confirm(msg)) return
  props.entries.splice(i, 1)
  if (expandedIndex.value === i) expandedIndex.value = null
  else if (expandedIndex.value !== null && expandedIndex.value > i) expandedIndex.value--
}

function summaryOf(e: RelationEntry): string {
  const bits: string[] = []
  if (props.showRole && e.role) bits.push(props.roleOptions?.[e.role] ?? e.role)
  if (e.startDate || e.endDate) bits.push(`${e.startDate ?? '?'}${e.endDate ? ` – ${e.endDate}` : ''}`)
  if (props.showPassed && e.passed === true)  bits.push('Bestått')
  if (props.showPassed && e.passed === false) bits.push('Ikke bestått')
  if (props.summaryExtra) {
    const extra = props.summaryExtra(e)
    if (extra) bits.push(extra)
  }
  return bits.join(' · ')
}

async function save() {
  if (!valid.value) return
  saving.value = true
  error.value = null
  try {
    await props.strategy.saveEntries(props.parentSlug, props.entries)

    const currentTargets  = new Set(props.entries.map(e => e.targetSlug).filter(Boolean))
    const previousTargets = new Set(originalEntries.value.filter(e => e.sections.length).map(e => e.targetSlug))
    const toSync          = new Set<string>([...currentTargets, ...previousTargets])

    for (const targetSlug of toSync) {
      const draft = props.entries.find(e => e.targetSlug === targetSlug)
      const sections = draft?.sections ?? []
      await props.strategy.saveNote(props.parentSlug, targetSlug, sections)
    }

    for (const e of props.entries) e.hasDescription = e.sections.length > 0

    snapshot()
    emit('saved')
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    saving.value = false
  }
}

function revert() {
  props.entries.splice(0, props.entries.length, ...originalEntries.value.map(cloneEntry))
  expandedIndex.value = null
  error.value = null
}
</script>

<style scoped>
.edit-section { margin-top: var(--space-lg); }

.edit-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 var(--space-md);
}

.edit-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}

.edit-btn-outline {
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.edit-btn-outline:hover { background: var(--paper-sunken); }

.edit-empty {
  padding: var(--space-md);
  text-align: center;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-style: italic;
  color: var(--muted);
  border: 1px dashed var(--rule);
  border-radius: var(--radius-md);
}

.edit-input {
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
.edit-input:focus {
  outline: 1px solid var(--focus);
  outline-offset: 0;
  border-color: var(--focus);
}
.edit-input-invalid {
  border-color: var(--danger);
  background: var(--paper-sunken);
}

/* ── List of memberships / attendances ──────────────────────── */
.membership-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.membership-item {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}
.membership-item.expanded { border-color: var(--focus); }

.membership-summary {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  color: var(--ink);
}

.membership-unit-name { font-weight: 600; color: var(--ink); }

.membership-meta {
  flex: 1;
  font-size: var(--size-label);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desc-marker {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--rule);
  background: var(--paper);
  color: var(--ink-soft);
  font-family: var(--font-serif);
  font-size: var(--size-label);
  font-weight: 600;
  font-style: italic;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: auto;
}

.membership-chevron {
  font-size: var(--size-label);
  color: var(--muted);
  flex-shrink: 0;
}

.membership-body {
  padding: 0 var(--space-md) var(--space-md);
  border-top: 1px dashed var(--rule);
}
.membership-body > * + * { margin-top: var(--space-sm); }

.membership-edit-top {
  display: grid;
  grid-template-columns: 1fr 160px auto;
  gap: var(--space-sm);
  align-items: center;
  margin-bottom: var(--space-sm);
}

.attendance-edit-top {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-sm);
  align-items: center;
  margin-bottom: var(--space-sm);
}

.membership-edit-dates {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: var(--space-sm);
  align-items: center;
  margin-bottom: var(--space-sm);
}

.edit-input-date {
  font-family: var(--font-mono);
  font-size: var(--size-mono);
}

.rank-dash { text-align: center; color: var(--muted); }

.passed-seg {
  display: inline-flex;
  gap: 0;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: var(--space-sm);
}
.passed-seg-opt {
  display: inline-flex;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}
.passed-seg-opt + .passed-seg-opt { border-left: 1px solid var(--rule); }
.passed-seg-opt input[type="radio"] {
  position: absolute;
  width: 1px; height: 1px;
  opacity: 0;
  pointer-events: none;
}
.passed-seg-opt.active {
  background: var(--ink);
  color: var(--paper);
  font-weight: 500;
}

.rank-remove-btn {
  height: 32px;
  padding: 0 var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--danger);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  cursor: pointer;
  white-space: nowrap;
}
.rank-remove-btn:hover { background: var(--paper-sunken); border-color: var(--danger); }

.membership-desc-wrap { display: flex; flex-direction: column; gap: var(--space-xs); }
.membership-desc-label {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
}

/* ── Unit picker ────────────────────────────────────────────── */
.unit-picker { position: relative; min-width: 0; }

.unit-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-xs) var(--space-xs) var(--space-md);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
}
.unit-chip-name { font-weight: 500; }
.unit-chip-clear {
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: var(--size-caps);
  color: var(--muted);
  background: transparent;
  border: none;
  border-radius: var(--radius-pill);
  cursor: pointer;
}
.unit-chip-clear:hover { background: var(--paper); color: var(--danger); }

.unit-results {
  position: absolute;
  top: calc(100% + var(--space-xs));
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 10;
}

.unit-result {
  display: block;
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
  text-align: left;
}
.unit-result:last-child { border-bottom: none; }
.unit-result:hover      { background: var(--paper-sunken); }

.unit-result--create {
  color: var(--faded-red);
  font-weight: 500;
  text-decoration: none;
  border-top: 1px solid var(--rule);
}
.unit-result--create:hover { background: var(--paper-sunken); }

/* ── Save bar ───────────────────────────────────────────────── */
.edit-save-bar {
  margin-top: var(--space-lg);
  padding: var(--space-md);
  background: var(--paper-sunken);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.edit-save-prompt {
  flex: 1;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink-soft);
  font-weight: 500;
}
.edit-btn-primary {
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
.edit-link-revert {
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
.edit-link-revert:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }
.edit-link-revert:disabled { opacity: 0.5; cursor: not-allowed; }

.edit-save-error {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-sunken);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}
</style>
