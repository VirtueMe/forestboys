<template>
  <div v-if="isAdmin && !inProposalPreview" class="admin-tabs">
    <button
      type="button"
      class="admin-tab"
      :class="{ active: modelValue === 'preview' }"
      @click="emit('update:modelValue', 'preview')"
    >
      Forhåndsvisning
    </button>
    <button
      type="button"
      class="admin-tab"
      :class="{ active: modelValue === 'edit' }"
      @click="emit('update:modelValue', 'edit')"
    >
      Rediger
    </button>
    <button
      v-if="(proposalCount && proposalCount > 0) || proposalRunning"
      type="button"
      class="admin-tab"
      :class="{ active: modelValue === 'proposals' }"
      @click="emit('update:modelValue', 'proposals')"
    >
      Forslag<span v-if="proposalCount"> ({{ proposalCount }})</span>
      <span v-if="proposalRunning" class="tab-spinner" aria-label="Forslag jobber" title="Forslag jobber">⏳</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { useAuth } from '@/composables/useAuth.ts'
import { ProposalPreviewKey } from '@/composables/proposalDataInjection.ts'

export type AdminViewMode = 'preview' | 'edit' | 'proposals'

defineProps<{ modelValue: AdminViewMode; proposalCount?: number; proposalRunning?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [mode: AdminViewMode] }>()

const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')
const inProposalPreview = inject(ProposalPreviewKey, false)
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

.tab-spinner {
  display: inline-block;
  margin-left: 6px;
  animation: tab-spin 1.6s linear infinite;
  font-size: 0.85em;
}
@keyframes tab-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>
