<template>
  <div ref="rootRef" class="custom-select" :class="{ open: isOpen, disabled }">
    <div class="custom-select-trigger" @click="toggleOpen">
      <span class="trigger-label">
        <template v-if="multiple">
          <template v-if="!(modelValue as string[]).length">
            <span class="placeholder">{{ placeholder }}</span>
          </template>
          <template v-else-if="(modelValue as string[]).length === options.length">
            <span class="placeholder">{{ placeholder }}</span>
          </template>
          <template v-else-if="(modelValue as string[]).length === 1">
            <span class="color-dot" :style="{ background: colorMap[(modelValue as string[])[0]] ?? '#666' }"></span>
            <span :style="{ color: colorMap[(modelValue as string[])[0]] ?? 'inherit' }">{{ (modelValue as string[])[0] }}</span>
          </template>
          <template v-else>
            <span class="label-mobile">
              <span
                v-for="val in (modelValue as string[])"
                :key="val"
                class="type-pill"
                :style="{ background: colorMap[val] ?? '#666' }"
              >{{ val }}</span>
            </span>
            <span class="label-desktop">
              <template v-for="(val, i) in (modelValue as string[])" :key="val">
                <span :style="{ color: colorMap[val] ?? 'inherit' }">{{ val }}</span>
                <span v-if="i < (modelValue as string[]).length - 1" class="sep">, </span>
              </template>
            </span>
          </template>
        </template>
        <template v-else>
          <span v-if="!(modelValue as string)" class="placeholder">{{ placeholder }}</span>
          <span v-else>{{ modelValue }}</span>
        </template>
      </span>
      <span class="chevron">▾</span>
    </div>

    <div v-if="isOpen" class="custom-select-options">
      <div v-if="!multiple" class="custom-option" @click="select('')">
        <span class="option-label placeholder">{{ placeholder }}</span>
      </div>
      <div
        v-for="opt in options"
        :key="opt"
        class="custom-option"
        :class="{ selected: isSelected(opt) }"
        :title="opt"
        @click="pick(opt)"
      >
        <span v-if="multiple" class="check">{{ isSelected(opt) ? '✓' : '' }}</span>
        <span class="color-dot" :style="{ background: colorMap[opt] ?? '#666' }"></span>
        <span class="option-label" :style="{ color: colorMap[opt] ?? 'inherit' }">{{ opt }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface Props {
  options:     string[]
  modelValue:  string | string[]
  placeholder: string
  multiple?:   boolean
  disabled?:   boolean
  colorMap?:   Record<string, string>
}

const props = withDefaults(defineProps<Props>(), {
  multiple:  false,
  disabled:  false,
  colorMap:  () => ({}),
})

const emit = defineEmits<{ (e: 'update:modelValue', val: string | string[]): void }>()

const isOpen  = ref(false)
const rootRef = ref<HTMLElement | null>(null)

function toggleOpen() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
}

function isSelected(opt: string): boolean {
  if (props.multiple) return (props.modelValue as string[]).includes(opt)
  return props.modelValue === opt
}

function select(val: string) {
  emit('update:modelValue', val)
  isOpen.value = false
}

function pick(opt: string) {
  if (!props.multiple) { select(opt); return }
  const current = props.modelValue as string[]
  const next = current.includes(opt)
    ? current.filter(v => v !== opt)
    : [...current, opt]
  emit('update:modelValue', next)
  // stay open for multi-select
}

function onDocClick(e: MouseEvent) {
  if (!isOpen.value) return
  if (!rootRef.value?.contains(e.target as Node)) isOpen.value = false
}

onMounted(() => document.addEventListener('click', onDocClick, true))
onUnmounted(() => document.removeEventListener('click', onDocClick, true))
</script>

<style scoped>
.custom-select {
  container-type: inline-size;
  position: relative;
  width: 100%;
  font-size: 13px;
  user-select: none;
}

.custom-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
  min-height: 30px;
  box-sizing: border-box;
}

.custom-select.disabled .custom-select-trigger {
  opacity: 0.45;
  cursor: default;
}

.custom-select.open .custom-select-trigger {
  border-color: var(--color-navy);
}

.trigger-label {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  flex-shrink: 0;
  color: var(--color-muted);
  font-size: 11px;
}

.custom-select-options {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  z-index: 200;
  max-height: 280px;
  overflow-y: auto;
}

.custom-option {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
}

.custom-option:last-child { border-bottom: none; }

.custom-option:hover { background: var(--color-bg); }

.custom-option.selected { background: color-mix(in srgb, var(--color-navy) 6%, transparent); }

.check {
  width: 14px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-navy);
  font-weight: 700;
}

.color-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.option-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.placeholder {
  color: var(--color-muted);
}

.label-mobile  { display: none; }
.label-desktop { display: inline; }
.sep { color: var(--color-handle); }

.type-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.03em;
}

@container (max-width: 260px) {
  .label-mobile  { display: flex; gap: 4px; align-items: center; }
  .label-desktop { display: none; }
}
</style>
