<template>
  <div class="tabs-root">
    <div class="tab-bar" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: modelValue === tab.id, disabled: tab.disabled }"
        :disabled="tab.disabled"
        role="tab"
        :aria-selected="modelValue === tab.id"
        @click="!tab.disabled && emit('update:modelValue', tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="tab-content">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  tabs: { id: string; label: string; disabled?: boolean }[]
  modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [id: string] }>()
</script>

<style scoped>
.tabs-root {
  display: flex;
  flex-direction: column;
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--rule);
  background: var(--paper-raised);
  position: sticky;
  top: 0;
  z-index: 10;
}

.tab-btn {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  cursor: pointer;
  transition: color 150ms ease, border-color 150ms ease;
}

.tab-btn.active {
  color: var(--ink);
  border-bottom-color: var(--faded-red);
}

.tab-btn:not(.active):not(.disabled):hover {
  color: var(--ink);
}

.tab-btn.disabled {
  color: var(--rule);
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
