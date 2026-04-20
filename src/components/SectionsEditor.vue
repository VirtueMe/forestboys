<template>
  <div class="sections-editor">
    <div class="sections-editor-head">
      <span v-if="label" class="sections-editor-label">{{ label }}</span>
      <button type="button" class="btn-secondary-outline" @click="addSection">+ Legg til seksjon</button>
    </div>

    <div class="sections">
      <div v-if="!sections.length" class="sections-empty">Ingen seksjoner ennå.</div>
      <div
        v-for="section in sortedSections"
        :key="section.order"
        class="section-block"
      >
        <div class="section-controls">
          <span class="section-index">Seksjon {{ section.order }}</span>
          <button type="button" class="section-btn" title="Opp"    @click="moveSection(section, -1)">↑</button>
          <button type="button" class="section-btn" title="Ned"    @click="moveSection(section, 1)">↓</button>
          <button type="button" class="section-btn section-btn-delete" title="Slett" @click="removeSection(section)">✕</button>
        </div>

        <PortableTextEditor
          :model-value="sectionBlocks(section)"
          @update:model-value="blocks => onContentChange(section, blocks)"
        />

        <div class="section-cites">
          <div class="section-cites-header">
            <span class="section-cites-label">Kilder</span>
          </div>
          <ul v-if="section.citations.length" class="section-cites-list">
            <template v-for="(c, i) in section.citations" :key="c.source.id">
              <li class="section-cite-item">
                <label class="section-cite-inline">
                  <input
                    type="checkbox"
                    :checked="c.inline"
                    @change="toggleCiteInline(section, i)"
                  />
                  inline
                </label>
                <span class="section-cite-title">{{ c.source.title || c.source.id }}</span>
                <span v-if="c.source.authorFreeText" class="section-cite-author">— {{ c.source.authorFreeText }}</span>
                <button type="button" class="section-btn" title="Rediger" @click="startEditSource(c.source.id)">✎</button>
                <button type="button" class="section-btn section-btn-delete" title="Fjern" @click="removeCite(section, i)">✕</button>
              </li>
              <li v-if="editingSourceId === c.source.id" class="section-cite-edit">
                <SourceEditForm
                  :source="c.source"
                  @saved="s => onSourceSaved(s)"
                  @cancel="editingSourceId = null"
                />
              </li>
            </template>
          </ul>
          <SourcePicker
            placeholder="Legg til kilde…"
            @pick="s => addCite(section, s)"
          />
        </div>

        <div class="section-sourced">
          <div class="section-sourced-header">
            <span class="section-sourced-label">Gjengitt fra</span>
          </div>
          <div v-if="section.sourcedFrom" class="section-sourced-chip">
            <span class="sc-title">{{ section.sourcedFrom.title || section.sourcedFrom.id }}</span>
            <span v-if="section.sourcedFrom.license" class="sc-license">{{ section.sourcedFrom.license }}</span>
            <button type="button" class="section-btn section-btn-delete" title="Fjern" @click="clearSourcedFrom(section)">✕</button>
          </div>
          <SourcePicker
            v-else
            placeholder="Sett kildematerial…"
            @pick="s => setSourcedFrom(section, s)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// The parent owns the `sections` array and passes it in for us to mutate
// in place (reactive proxy handles propagation). That pattern trips
// vue/no-mutating-props even though it's intentional here — disable
// for this file only.
/* eslint-disable vue/no-mutating-props */
import { computed, ref } from 'vue'
import PortableTextEditor from '@/components/PortableTextEditor.vue'
import SourcePicker from '@/components/SourcePicker.vue'
import SourceEditForm from '@/components/SourceEditForm.vue'
import type { PortableTextBlock } from '@portabletext/editor'

export interface SourceRef {
  id:             string
  title:          string | null
  url:            string | null
  authorFreeText: string | null
  license?:       string | null
  attribution?:   string | null
}

export interface Citation {
  inline: boolean
  source: SourceRef
}

export interface Section {
  order:       number
  content:     string   // JSON-serialised PortableTextBlock[]
  citations:   Citation[]
  sourcedFrom: SourceRef | null
}

const props = defineProps<{
  /** Mutated in place; parent owns reactivity + dirty tracking. */
  sections: Section[]
  label?:   string
}>()

const sortedSections = computed(() => [...props.sections].sort((a, b) => a.order - b.order))

const editingSourceId = ref<string | null>(null)

function sectionBlocks(s: Section): PortableTextBlock[] {
  try { return JSON.parse(s.content) as PortableTextBlock[] } catch { return [] }
}

function onContentChange(s: Section, blocks: PortableTextBlock[]) {
  s.content = JSON.stringify(blocks)
}

function addSection() {
  const maxOrder = props.sections.reduce((m, s) => Math.max(m, s.order), 0)
  props.sections.push({ order: maxOrder + 1, content: '[]', citations: [], sourcedFrom: null })
}

function removeSection(s: Section) {
  const i = props.sections.indexOf(s)
  if (i !== -1) props.sections.splice(i, 1)
  // Re-number surviving sections
  const sorted = [...props.sections].sort((a, b) => a.order - b.order)
  sorted.forEach((x, idx) => { x.order = idx + 1 })
}

function moveSection(s: Section, direction: -1 | 1) {
  const ordered = [...props.sections].sort((a, b) => a.order - b.order)
  const i = ordered.indexOf(s)
  const j = i + direction
  if (j < 0 || j >= ordered.length) return
  const tmp = ordered[i].order
  ordered[i].order = ordered[j].order
  ordered[j].order = tmp
}

function addCite(section: Section, source: SourceRef) {
  if (section.citations.some(c => c.source.id === source.id)) return
  section.citations.push({ inline: false, source: { ...source } })
}

function removeCite(section: Section, index: number) {
  section.citations.splice(index, 1)
}

function toggleCiteInline(section: Section, index: number) {
  const c = section.citations[index]
  if (c) c.inline = !c.inline
}

function setSourcedFrom(section: Section, source: SourceRef) {
  section.sourcedFrom = { ...source }
}

function clearSourcedFrom(section: Section) {
  section.sourcedFrom = null
}

function startEditSource(id: string) {
  editingSourceId.value = editingSourceId.value === id ? null : id
}

function onSourceSaved(updated: SourceRef) {
  // Patch every matching citation.source in the current sections.
  for (const s of props.sections) {
    for (const c of s.citations) {
      if (c.source.id === updated.id) c.source = { ...updated }
    }
    if (s.sourcedFrom?.id === updated.id) s.sourcedFrom = { ...updated }
  }
  editingSourceId.value = null
}
</script>

<style scoped>
.sections-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.sections-editor-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.btn-secondary-outline {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  background: transparent;
  color: var(--color-navy);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
}
.btn-secondary-outline:hover { border-color: var(--color-navy); }

.sections { display: flex; flex-direction: column; gap: 16px; }

.sections-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  font-style: italic;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
}

.section-block {
  padding: 12px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.section-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.section-index {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.section-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  color: var(--color-text);
}
.section-btn:hover { border-color: var(--color-navy); }
.section-btn-delete { color: #b91c1c; }
.section-btn-delete:hover { background: #fef2f2; border-color: #fecaca; }

.section-cites {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-cites-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-cites-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.section-cites-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-cite-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
}

.section-cite-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-muted);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.section-cite-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-cite-author {
  font-size: 11px;
  color: var(--color-muted);
  flex-shrink: 0;
}

.section-cite-edit { list-style: none; padding: 0; }

.section-sourced {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-sourced-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.section-sourced-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
}

.sc-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-license {
  font-family: monospace;
  font-size: 10px;
  padding: 1px 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
}
</style>
