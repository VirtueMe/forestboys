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
  gap: 4px;
  padding: 6px 12px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
}

.admin-tab {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-muted);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  font-family: inherit;
}

.admin-tab.active {
  color: var(--color-navy);
  border-bottom-color: var(--color-navy);
}
</style>
