<template>
  <div v-if="isAdmin" class="admin-tabs">
    <button
      type="button"
      class="admin-tab"
      :class="{ active: modelValue === 'preview' }"
      @click="emit('update:modelValue', 'preview')"
    >Forhåndsvisning</button>
    <button
      type="button"
      class="admin-tab"
      :class="{ active: modelValue === 'edit' }"
      @click="emit('update:modelValue', 'edit')"
    >Rediger</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuth } from '@/composables/useAuth.ts'

export type AdminViewMode = 'preview' | 'edit'

defineProps<{ modelValue: AdminViewMode }>()
const emit = defineEmits<{ 'update:modelValue': [mode: AdminViewMode] }>()

const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')
</script>

<style scoped>
.admin-tabs {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  box-shadow: var(--shadow-sm);
}

.admin-tab {
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
}

.admin-tab.active {
  color: var(--ink);
  border-bottom-color: var(--faded-red);
}
</style>
