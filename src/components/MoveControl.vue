<template>
  <div ref="root" class="move-wrap" :class="{ open }" @keydown.esc="emit('close')">
    <button
      type="button"
      class="move-toggle"
      aria-haspopup="true"
      :aria-expanded="open"
      :aria-label="`Flytt ${name}`"
      @click="emit('toggle')"
    >
      Flytt
    </button>
    <div v-if="open" class="move-panel" role="group" :aria-label="`Plassering for ${name}`">
      <div class="move-pos">
        <label class="move-pos-label">
          Plass
          <input
            ref="input"
            v-model="typed"
            class="move-pos-input"
            :class="{ invalid: error }"
            type="text"
            inputmode="numeric"
            aria-label="Plassering"
            :aria-invalid="!!error"
            @keydown.enter.prevent="apply"
          />
        </label>
        <span>av {{ total }}</span>
        <button
          type="button"
          class="move-btn"
          aria-label="Flytt til valgt plass"
          :disabled="!!error || Number(typed) === position"
          @click="apply"
        >
          Flytt
        </button>
      </div>
      <p v-if="error" class="move-error" role="alert">{{ error }}</p>
      <div class="move-steps">
        <button type="button" class="move-btn" :disabled="position === 1" @click="emit('move', 0)">Til toppen</button>
        <button type="button" class="move-btn" :disabled="position === 1" @click="emit('move', position - 2)">Opp</button>
        <button type="button" class="move-btn" :disabled="position === total" @click="emit('move', position)">Ned</button>
        <button type="button" class="move-btn" :disabled="position === total" @click="emit('move', total - 1)">Til bunnen</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * «Flytt» on a row of a list ordered by hand (#355): a position box that is checked, and the steps up, down, to the
 * top and to the bottom. The list owns the order and which row's panel is open, so one is open at a time.
 * `move` gives the new 0-based index.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  /** 1-based place of this row. */
  position: number
  total:    number
  name:     string
  open:     boolean
}>()

const emit = defineEmits<{ toggle: []; close: []; move: [to: number] }>()

const root  = useTemplateRef<HTMLElement>('root')
const input = useTemplateRef<HTMLInputElement>('input')
const typed = ref('')
const error = computed(() => {
  const text = typed.value.trim()
  if (!/^\d+$/.test(text)) return 'Skriv et tall.'
  const n = Number(text)
  return n < 1 || n > props.total ? `Velg en plass fra 1 til ${props.total}.` : ''
})

watch(() => props.position, p => { typed.value = String(p) })
watch(() => props.open, open => {
  if (!open) return
  typed.value = String(props.position)
  // The position is what is typed first: ready to replace.
  void nextTick(() => input.value?.select())
}, { immediate: true })

function apply() {
  if (error.value || Number(typed.value) === props.position) return
  emit('move', Number(typed.value) - 1)
}

function onPointerDown(ev: PointerEvent) {
  if (props.open && !root.value?.contains(ev.target as Node)) emit('close')
}
onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<style scoped>
.move-wrap {
  position: relative;
  padding-right: var(--space-sm);
  flex-shrink: 0;
}
.move-toggle,
.move-btn {
  height: 32px;
  padding: 0 var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  cursor: pointer;
  white-space: nowrap;
}
.move-toggle:hover,
.move-wrap.open .move-toggle,
.move-btn:hover:not(:disabled) { background: var(--paper-sunken); }
.move-btn:disabled { color: var(--muted); cursor: default; opacity: 0.5; }

.move-panel {
  position: absolute;
  top: calc(100% + var(--space-xs));
  right: var(--space-sm);
  z-index: 10;
  width: 260px;
  max-width: calc(100vw - 2 * var(--space-md));
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.move-pos {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  white-space: nowrap;
}
.move-pos-label { display: flex; align-items: center; gap: var(--space-sm); }
.move-pos .move-btn { margin-left: auto; }
.move-pos-input {
  width: 56px;
  box-sizing: border-box;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  text-align: center;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}
.move-pos-input:focus { outline: 1px solid var(--focus); outline-offset: 0; border-color: var(--focus); }
.move-pos-input.invalid { border-color: var(--danger); background: var(--paper-sunken); }
.move-error {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}
.move-steps { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs); }
</style>
