<template>
  <div ref="host" class="pt-editor-host"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { PortableTextEditorReact } from './PortableTextEditorReact.tsx'
import type { PortableTextBlock } from '@portabletext/editor'

const props = defineProps<{ modelValue: PortableTextBlock[] }>()
const emit = defineEmits<{ 'update:modelValue': [blocks: PortableTextBlock[]] }>()

const host = ref<HTMLElement | null>(null)
let root: Root | null = null

function render() {
  if (!root) return
  root.render(
    React.createElement(PortableTextEditorReact, {
      value:    props.modelValue,
      onChange: (blocks: PortableTextBlock[]) => emit('update:modelValue', blocks),
    }),
  )
}

onMounted(() => {
  if (!host.value) return
  root = createRoot(host.value)
  render()
  watch(() => props.modelValue, render)
})

onBeforeUnmount(() => {
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
.pt-tb-btn.active { background: var(--focus); color: #fff; border-color: var(--focus); }

.pt-tb-sep {
  display: inline-block;
  width: 1px;
  background: var(--rule);
  margin: 2px 4px;
}

.pt-editable {
  min-height: 200px;
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
.pt-editable blockquote {
  border-left: 3px solid var(--rule);
  padding-left: 12px;
  color: var(--muted);
  font-style: italic;
  margin: 0 0 0.75em;
}

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
  position: relative;
  display: inline-block;
}

.pt-person-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 240px;
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
