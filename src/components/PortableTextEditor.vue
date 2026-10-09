<template>
  <div ref="host" class="pt-editor-host" :class="{ 'pt-editor-host--full': expanded }"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { PortableTextEditorReact } from './PortableTextEditorReact.tsx'
import type { PortableTextBlock } from '@portabletext/editor'

const props = withDefaults(defineProps<{ modelValue: PortableTextBlock[]; label?: string }>(), { label: 'Beskrivelse' })
const emit = defineEmits<{ 'update:modelValue': [blocks: PortableTextBlock[]] }>()

const host = ref<HTMLElement | null>(null)
let root: Root | null = null

// Full window (#123): the same editor, the same React root, only the host's size changes — so the
// draft, the selection and the undo history are the ones the inline editor has. Not a second editor.
const expanded = ref(false)

// The React editor takes its value once, when it mounts. A change that did not come from the editor
// itself (a repaired heading, a fixed link, «Angre») would never reach it, and its next keystroke
// would put the old content back. So what the editor holds is remembered (what it last reported, or
// what it was started over with), and a different incoming value starts it over. The draft is a JSON
// string that comes back exactly as it was reported, so typing never looks like an outside change.
let held: string | null = null
let generation = 0

// The editor reports a change late (about 0.3 s after typing, 1 s after an undo), so the draft can
// be behind the screen. `flush` reads what the editor holds right now and reports it at once (#145).
let read: (() => PortableTextBlock[] | undefined) | null = null
function flush() {
  const blocks = read?.()
  if (!blocks) return
  const now = JSON.stringify(blocks)
  if (now === held) return
  held = now
  emit('update:modelValue', blocks)
}
defineExpose({ flush })

function render() {
  if (!root) return
  root.render(
    React.createElement(PortableTextEditorReact, {
      value:    props.modelValue,
      label:    props.label,
      generation,
      onChange: (blocks: PortableTextBlock[]) => {
        held = JSON.stringify(blocks)
        emit('update:modelValue', blocks)
      },
      expanded: expanded.value,
      onToggleExpand: () => { expanded.value = !expanded.value },
      registerReader: (fn: (() => PortableTextBlock[] | undefined) | null) => { read = fn },
    }),
  )
}

// Esc shrinks it again — unless something inside already used the key (the Lenke box closes on Esc).
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !e.defaultPrevented) expanded.value = false
}

watch(expanded, on => {
  render()
  if (on) document.addEventListener('keydown', onKeydown)
  else document.removeEventListener('keydown', onKeydown)
})

onMounted(() => {
  if (!host.value) return
  root = createRoot(host.value)
  render()
  watch(() => props.label, render)
  watch(() => props.modelValue, value => {
    const incoming = JSON.stringify(value)
    if (incoming !== held) { generation++; held = incoming }
    render()
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  root?.unmount()
  root = null
})
</script>

<style scoped>
.pt-editor-host {
  width: 100%;
}
</style>

<style>
/* Unscoped — React-rendered elements won't carry the scoped data attribute. */
.pt-toolbar {
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  flex-wrap: wrap;
}

.pt-tb-btn {
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
}
.pt-tb-btn:hover  { background: var(--paper-raised); }
.pt-tb-menu { position: relative; display: inline-flex; }
/* H3 and the ▾ are one split button: the group draws the outline, a hairline divides the two. */
.pt-tb-split {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--rule);
  border-radius: 4px;
}
.pt-tb-split .pt-tb-btn { border-color: transparent; border-radius: 0; }
.pt-tb-split > .pt-tb-btn { border-radius: 3px 0 0 3px; }
.pt-tb-split .pt-tb-menu .pt-tb-btn { border-radius: 0 3px 3px 0; }
.pt-tb-more { min-width: 24px; padding: 0 4px; font-size: 13px; }
.pt-tb-split .pt-tb-more { border-left-color: var(--rule); }

.pt-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  min-width: 64px;
  display: flex;
  flex-direction: column;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px;
}
.pt-menu-item {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  text-align: left;
  color: var(--ink);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
}
.pt-menu-item:hover  { background: var(--paper); }
.pt-menu-item.active { background: var(--focus); color: #fff; border-color: var(--focus); }

.pt-tb-btn:disabled { opacity: 0.4; cursor: default; }
.pt-tb-btn:disabled:hover { background: transparent; }
.pt-tb-btn.active { background: var(--focus); color: #fff; border-color: var(--focus); }

.pt-tb-sep {
  display: inline-block;
  width: 1px;
  background: var(--rule);
  margin: 2px 4px;
}

/* Lists (#124). The editor renders a list item as a div with data-list-item (bullet | number),
   data-level (1, 2, …) and data-list-index (the item's number within its list: it restarts after a
   paragraph, or a list of the other kind, as the page does when it makes a new <ol>). Markers and
   indent are drawn here: indent per level, bullets that change with the level, plain numbers like
   the page's nested <ol>s. The marker box fits "30." on one line (nowrap), and the padding sits
   0.4em past it. */
.pt-editable [data-list-item] { position: relative; padding-left: 2em; }
.pt-editable [data-list-item][data-level="2"] { padding-left: 3.6em; }
.pt-editable [data-list-item][data-level="3"] { padding-left: 5.2em; }
.pt-editable [data-list-item][data-level="4"],
.pt-editable [data-list-item][data-level="5"] { padding-left: 6.8em; }

.pt-editable [data-list-item]::before {
  position: absolute;
  left: 0;
  width: 1.6em;
  text-align: right;
  white-space: nowrap;
  color: var(--muted);
}
.pt-editable [data-list-item][data-level="2"]::before { left: 1.6em; }
.pt-editable [data-list-item][data-level="3"]::before { left: 3.2em; }
.pt-editable [data-list-item][data-level="4"]::before,
.pt-editable [data-list-item][data-level="5"]::before { left: 4.8em; }

.pt-editable [data-list-item="bullet"]::before { content: '•'; }
.pt-editable [data-list-item="bullet"][data-level="2"]::before { content: '◦'; }
.pt-editable [data-list-item="bullet"][data-level="3"]::before { content: '▪'; }
.pt-editable [data-list-item="number"]::before { content: attr(data-list-index) '.'; }

/* Icon buttons (link, expand) centre their svg. */
.pt-tb-btn svg { display: block; }

/* Far right of the toolbar, as in Sanity. */
.pt-tb-expand { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; }

/* Full window (#123): the host fills the viewport above the nav (z-index 100–200) and the save bar,
   below anything modal. overscroll-behavior stops a scroll that reaches the end of the text from
   moving the page behind it. The page is zoomed (--page-zoom), which scales the padding but not 100vw,
   so the viewport is divided by the zoom to keep the editor 960 page px wide at every size. */
.pt-editor-host--full {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  flex-direction: column;
  padding: 12px max(12px, calc((100vw / var(--page-zoom) - 960px) / 2));
  background: var(--paper);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.pt-editor-host--full .pt-editable {
  flex: 1;
  min-height: 0;
  max-height: none;
  overscroll-behavior: contain;
}

/* The text scrolls inside its box, as in Sanity, so the toolbar above it stays in view (#123). */
.pt-editable {
  min-height: 200px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--rule);
  border-radius: 0 0 6px 6px;
  background: var(--paper);
  font-size: 14px;
  line-height: 1.6;
  outline: none;
}
.pt-editable:focus { border-color: var(--focus); }

.pt-editable p { margin: 0.5em 0 0.75em; }
.pt-editable h1         { font-size: 24px; font-weight: 700; margin: 0 0 0.5em; color: var(--focus); }
.pt-editable h2         { font-size: 20px; font-weight: 700; margin: 0 0 0.5em; color: var(--focus); }
.pt-editable h3         { font-size: 17px; font-weight: 700; margin: 0 0 0.5em; color: var(--focus); }
.pt-editable h4         { font-size: 15.5px; font-weight: 700; margin: 0 0 0.5em; color: var(--focus); }
.pt-editable h5         { font-size: 14px; font-weight: 700; margin: 0 0 0.5em; color: var(--focus); }
.pt-editable h6         { font-size: 12px; font-weight: 700; margin: 0 0 0.5em; color: var(--focus); text-transform: uppercase; letter-spacing: 0.06em; }
.pt-editable blockquote {
  border-left: 3px solid var(--rule);
  padding-left: 12px;
  color: var(--muted);
  font-style: italic;
  margin: 0 0 0.75em;
}

/* Links: ink with a hairline underline, faded-red on hover (DESIGN.md). */
.pt-link-mark {
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--rule);
  cursor: text;
}
.pt-link-mark:hover { color: var(--faded-red); border-bottom-color: var(--faded-red); }
/* A stored link with no address leads nowhere — shown, so it can be fixed. */
.pt-link-mark--dead { border-bottom: 1px dashed var(--faded-red); }

/* The popups hang from the toolbar, not from their button: a button's popup ran past the right edge
   of a narrow window and was clipped by the scrolling page. Anchored to the toolbar, a popup is never
   wider than it and never past its edge. */
.pt-toolbar { position: relative; }

.pt-tb-link {
  position: static;
  display: inline-block;
}

.pt-link-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: min(560px, 100%);
  box-sizing: border-box;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 20;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pt-link-field { display: flex; flex-direction: column; gap: 3px; }
.pt-link-label { font-size: 11px; font-weight: 600; color: var(--muted); }
.pt-link-input[readonly] { color: var(--muted); background: transparent; }

.pt-link-input {
  padding: 7px 10px;
  font-size: 13px;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 3px;
  box-sizing: border-box;
  outline: none;
}
.pt-link-input:focus { border-color: var(--focus); }

.pt-link-actions { display: flex; gap: 6px; }

.pt-link-apply,
.pt-link-remove {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  border-radius: 3px;
  cursor: pointer;
}
.pt-link-apply  { color: #fff; background: var(--focus); border: 1px solid var(--focus); }
.pt-link-apply:disabled { opacity: 0.4; cursor: default; }
.pt-link-remove { color: var(--faded-red); background: transparent; border: 1px solid var(--rule); }
.pt-link-remove:hover { border-color: var(--faded-red); }

.pt-person-mark {
  color: var(--focus);
  background: rgba(5, 35, 69, 0.08);
  border-radius: 2px;
  padding: 1px 2px;
  text-decoration: none;
  cursor: pointer;
}
.pt-person-mark:hover { background: rgba(5, 35, 69, 0.14); }

.pt-tb-person {
  position: static;
  display: inline-block;
}

.pt-person-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: min(240px, 100%);
  max-width: 100%;
  box-sizing: border-box;
  max-height: 280px;
  overflow-y: auto;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 20;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pt-person-input {
  padding: 7px 10px;
  font-size: 13px;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 3px;
  box-sizing: border-box;
  margin-bottom: 4px;
  outline: none;
}
.pt-person-input:focus { border-color: var(--focus); }

.pt-person-result {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  padding: 6px 8px;
  font-size: 13px;
  color: var(--ink);
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.pt-person-result:hover { background: var(--paper); }

.pt-person-slug {
  font-size: 10px;
  font-family: monospace;
  color: var(--muted);
}
</style>
