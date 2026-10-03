<template>
  <div class="license-picker">
    <input
      v-model="query"
      class="picker-input"
      type="text"
      :placeholder="placeholder ?? 'Lisens (SPDX)…'"
      :title="modelValue || ''"
      @focus="open = true"
      @blur="onBlur"
    />
    <div v-if="open && results.length" class="picker-results">
      <button
        v-for="id in results"
        :key="id"
        type="button"
        class="picker-result"
        :class="{ 'is-sentinel': isSentinel(id) }"
        @mousedown.prevent="pick(id)"
      >
        {{ id }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import spdxIds from 'spdx-license-ids'
import { NOASSERTION, LICENSE_REF_COPYRIGHT, normalizeLicense } from '@/utils/licenseForDomain.ts'

const SENTINELS: string[] = [NOASSERTION, LICENSE_REF_COPYRIGHT]
const ALL: string[] = [...SENTINELS, ...spdxIds]

const props = defineProps<{
  modelValue:   string | null
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const query   = ref(normalizeLicense(props.modelValue))
const open    = ref(false)
const results = ref<string[]>([])

watch(() => props.modelValue, v => { query.value = normalizeLicense(v) })

watch(query, q => {
  const needle = q.trim().toLowerCase()
  if (!needle) { results.value = SENTINELS.concat(ALL.slice(SENTINELS.length, SENTINELS.length + 10)); return }
  results.value = ALL.filter(id => id.toLowerCase().includes(needle)).slice(0, 20)
})

function pick(id: string) {
  query.value = id
  emit('update:modelValue', id)
  open.value = false
}

function onBlur() {
  window.setTimeout(() => { open.value = false }, 150)
  // commit free text even if the user didn't click a result
  if (query.value && query.value !== props.modelValue) emit('update:modelValue', query.value.trim())
}

function isSentinel(id: string): boolean {
  return (SENTINELS as readonly string[]).includes(id)
}
</script>

<style scoped>
.license-picker { position: relative; }

.picker-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}
.picker-input:focus {
  outline: 1px solid var(--focus);
  outline-offset: 0;
  border-color: var(--focus);
}

.picker-results {
  position: absolute;
  top: calc(100% + var(--space-xs));
  left: 0;
  right: 0;
  max-height: 220px;
  overflow-y: auto;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 30;
}

.picker-result {
  display: block;
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  color: var(--ink);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
  text-align: left;
}
.picker-result:last-child { border-bottom: none; }
.picker-result:hover      { background: var(--paper-sunken); }
.picker-result.is-sentinel {
  color: var(--faded-red);
  font-family: var(--font-sans);
  font-weight: 500;
}
</style>
