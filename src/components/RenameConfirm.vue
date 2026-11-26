<template>
  <AppModal v-model="open" title="Endre adressen?">
    <div v-if="plan" class="rename-body">
      <p class="rename-intro">
        Adressen endres fra
        <code class="rename-path">{{ route }}{{ plan.from }}</code> til
        <code class="rename-path">{{ route }}{{ plan.to }}</code>.
        {{ plan.restoresAlias ? 'Dette var tidligere adressen til siden; henvisningen fra den gamle fjernes.' : 'Den gamle adressen sender leseren videre til den nye.' }}
      </p>
      <p class="rename-links">{{ linksSummary(plan) }}</p>
      <p v-if="warning" class="rename-intro">{{ warning }}</p>
      <footer class="rename-actions">
        <button type="button" class="rename-cancel" @click="open = false">Avbryt</button>
        <button type="button" class="edit-btn-primary" :disabled="busy" @click="emit('confirm')">{{ confirmLabel }}</button>
      </footer>
    </div>
  </AppModal>
</template>

<script setup lang="ts">
/** The question before a slug is changed (#96): the new address, and what is rewritten to it. */
import AppModal from '@/components/AppModal.vue'
import { linksSummary, type RenamePreview } from '@/utils/renameSummary.ts'

defineProps<{
  plan:         RenamePreview | null
  route:        string
  confirmLabel: string
  warning?:     string
  busy?:        boolean
}>()
const emit = defineEmits<{ confirm: [] }>()
const open = defineModel<boolean>({ required: true })
</script>

<style scoped>
.rename-body {
  padding: var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.rename-intro { margin: 0; color: var(--ink-soft); line-height: 1.5; }
.rename-path { font-family: var(--font-mono); font-size: var(--size-mono); color: var(--ink); overflow-wrap: anywhere; }
.rename-links { margin: 0; color: var(--ink); line-height: 1.5; }
.rename-actions { display: flex; justify-content: flex-end; gap: var(--space-sm); flex-wrap: wrap; }
.edit-btn-primary {
  padding: var(--space-sm) var(--space-lg);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  background: var(--faded-red);
  color: var(--paper);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.edit-btn-primary:hover:not(:disabled) { background: var(--faded-red-soft); }
.edit-btn-primary:disabled { background: var(--paper); color: var(--muted); cursor: not-allowed; }
.rename-cancel {
  background: none;
  border: none;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink-soft);
  text-decoration: underline;
  cursor: pointer;
}
</style>
