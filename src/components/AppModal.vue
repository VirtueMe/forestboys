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
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;        /* mobile: slide up from bottom */
  justify-content: center;
  padding: 0;
}

@media (min-width: 600px) {
  .modal-backdrop {
    align-items: center;        /* desktop: centered */
    padding: 24px;
  }
}

.modal-card {
  background: var(--color-surface);
  border-radius: 12px 12px 0 0;
  width: 100%;
  max-height: 85dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (min-width: 600px) {
  .modal-card {
    border-radius: 12px;
    width: 100%;
    max-width: 560px;
    max-height: 80dvh;
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.modal-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
}

.modal-close {
  background: none;
  border: none;
  font-size: 14px;
  color: var(--color-muted);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  line-height: 1;
}
.modal-close:hover { background: var(--color-border); color: var(--color-text); }

.modal-body {
  overflow-y: auto;
  flex: 1;
  padding-bottom: 24px;
}

/* ── Transitions ──────────────────────────────────────────────── */
.modal-enter-active,
.modal-leave-active { transition: opacity 0.18s ease; }
.modal-enter-active .modal-card,
.modal-leave-active .modal-card { transition: transform 0.18s ease; }

.modal-enter-from,
.modal-leave-to { opacity: 0; }
.modal-enter-from .modal-card,
.modal-leave-to  .modal-card  { transform: translateY(20px); }
</style>
