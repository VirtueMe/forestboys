<template>
  <div class="create-wrap">
    <button
      ref="btnRef"
      type="button"
      class="create-btn"
      :class="{ open }"
      @click="open = !open"
    >
      + Ny…
    </button>

    <div v-if="open" class="create-menu" @click.stop>
      <button
        v-for="k in KINDS"
        :key="k.kind"
        type="button"
        class="create-menu-item"
        @click="pick(k.kind)"
      >
        {{ k.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * RegistreCreateButton — "+ Ny…" dropdown on /registre. Each menu
 * entry routes to its detail page's in-page create flow at
 * `/<type>/new`; the target pages handle the form, validation, and
 * persistence themselves.
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

type Kind = 'organization' | 'person' | 'unit' | 'station' | 'location' | 'equipment' | 'transport'

const KINDS: ReadonlyArray<{ kind: Kind; label: string; path: string }> = [
  { kind: 'organization', label: 'Organisasjon',    path: '/organization/new' },
  { kind: 'person',       label: 'Person',          path: '/person/new' },
  { kind: 'unit',         label: 'Avdeling',        path: '/district/new' },
  { kind: 'station',      label: 'Stasjon',         path: '/station/new' },
  { kind: 'location',     label: 'Sted',            path: '/location/new' },
  { kind: 'equipment',    label: 'Utstyr',          path: '/equipment/new' },
  { kind: 'transport',    label: 'Fremkomstmiddel', path: '/transport/new' },
]

const router = useRouter()
const btnRef = ref<HTMLButtonElement | null>(null)
const open   = ref(false)

function pick(k: Kind) {
  open.value = false
  const entry = KINDS.find(e => e.kind === k)
  if (entry) void router.push(entry.path)
}

// Close dropdown on outside click.
function onDocClick(e: MouseEvent) {
  if (!open.value) return
  if (btnRef.value && btnRef.value.contains(e.target as Node)) return
  open.value = false
}
onMounted(()  => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.create-wrap { position: relative; display: inline-block; }

.create-btn {
  height: 32px;
  padding: 0 14px;
  background: var(--focus);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease-out;
}
.create-btn:hover { background: var(--faded-red); }
.create-btn.open { background: var(--faded-red); }

.create-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 180px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.create-menu-item {
  text-align: left;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  cursor: pointer;
}
.create-menu-item:hover { background: var(--paper-sunken); color: var(--faded-red); }
</style>
