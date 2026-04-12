<template>
  <div class="tabs-root">
    <div class="tab-bar" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: modelValue === tab.id }"
        role="tab"
        :aria-selected="modelValue === tab.id"
        @click="emit('update:modelValue', tab.id)"
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
  tabs: { id: string; label: string }[]
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
  border-bottom: 1px solid var(--color-border, #333);
  background: var(--color-surface, #1a1a1a);
  position: sticky;
  top: 0;
  z-index: 10;
}

.tab-btn {
  flex: 1;
  padding: 12px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-text-muted, #888);
  font-size: 0.85rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.tab-btn.active {
  color: var(--color-text, #fff);
  border-bottom-color: var(--color-accent, #e8a020);
}

.tab-btn:not(.active):hover {
  color: var(--color-text, #fff);
}
</style>
