<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="modal-backdrop" @click.self="emit('update:modelValue', false)">
        <div class="modal-card" role="dialog" :aria-label="title">
          <div class="modal-header">
            <span class="modal-title">{{ title }}</span>
            <button class="modal-close" aria-label="Lukk" @click="emit('update:modelValue', false)">✕</button>
          </div>
          <div class="modal-body">
            <slot></slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{ modelValue: boolean; title?: string }>()
const emit  = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.modelValue) emit('update:modelValue', false)
}
onMounted(()   => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(26, 26, 26, 0.55);
  display: flex;
  align-items: flex-end;        /* mobile: slide up from bottom */
  justify-content: center;
  padding: 0;
}

@media (min-width: 600px) {
  .modal-backdrop {
    align-items: center;        /* desktop: centered */
    padding: var(--space-lg);
  }
}

.modal-card {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-bottom: none;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: var(--shadow-md);
  width: 100%;
  max-height: 85dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (min-width: 600px) {
  .modal-card {
    border-bottom: 1px solid var(--rule);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: 560px;
    max-height: 80dvh;
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md);
  border-bottom: 1px solid var(--rule);
  flex-shrink: 0;
}

.modal-title {
  font-family: var(--font-sans);
  font-size: var(--size-h3);
  font-weight: 600;
  color: var(--ink);
}

.modal-close {
  background: none;
  border: none;
  font-size: var(--size-body-ui);
  color: var(--muted);
  cursor: pointer;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  line-height: 1;
}
.modal-close:hover { background: var(--paper-sunken); color: var(--faded-red); }

.modal-body {
  overflow-y: auto;
  flex: 1;
  padding-bottom: var(--space-lg);
}

/* ── Transitions ──────────────────────────────────────────────── */
.modal-enter-active,
.modal-leave-active { transition: opacity 180ms ease; }
.modal-enter-active .modal-card,
.modal-leave-active .modal-card { transition: transform 180ms ease; }

.modal-enter-from,
.modal-leave-to { opacity: 0; }
.modal-enter-from .modal-card,
.modal-leave-to  .modal-card  { transform: translateY(20px); }
</style>
