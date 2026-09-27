<template>
  <span v-if="!hasDescription">{{ label }}</span>
  <span v-else ref="wrap" class="role-label-wrap">
    <button
      type="button"
      class="role-label"
      :aria-expanded="open"
      :aria-label="`Forklaring: ${label}`"
      :title="plainText"
      @click.stop="open = !open"
    >{{ label }}</button>
    <span v-if="open" class="role-popover" role="dialog" :aria-label="label">
      <span class="role-popover-header">
        <span class="role-popover-kind">Rolle</span>
        <button class="role-popover-close" type="button" aria-label="Lukk" @click.stop="open = false">×</button>
      </span>
      <span class="role-popover-name">{{ label }}</span>
      <!-- eslint-disable vue/no-v-html -->
      <span class="role-popover-text portable-text" v-html="html"></span>
      <!-- eslint-enable vue/no-v-html -->
      <span v-if="role?.sourceIds.length" class="role-popover-sources">
        <SourceRef :refs="role.sourceIds" />
      </span>
    </span>
  </span>
</template>

<script setup lang="ts">
/**
 * RoleLabel — a relation role as shown to visitors (docs/ROLES.md R11–R14).
 *
 * Shows the Role's name (falling back to the caller's label, then the
 * raw key). When the role has a description, the label itself is the
 * trigger — dotted underline; click / tap / Enter opens a popover with
 * the description and its sources as SourceRef chips. Hover gives the
 * plain text via `title`. Without a description it renders plain text.
 *
 * Deliberately not an (i): relation rows already use (i) for "this link
 * has a note".
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoles } from '@/composables/useRoles.ts'
import { blocksToHtml, blocksToText } from '@/utils/portableText.ts'
import SourceRef from '@/components/SourceRef.vue'

const props = defineProps<{
  roleKey:   string
  /** Label to show until / unless the Role node provides a name. */
  fallback?: string | null
}>()

const { roles } = useRoles()
const role  = computed(() => roles.value.get(props.roleKey) ?? null)
const label = computed(() => role.value?.name ?? props.fallback ?? props.roleKey)

type Blocks = Parameters<typeof blocksToHtml>[0]
function parsed(): Blocks[] {
  return (role.value?.sections ?? []).flatMap((c) => {
    try { return [JSON.parse(c) as Blocks] } catch { return [] }
  })
}
const html           = computed(() => parsed().map(b => blocksToHtml(b)).join(''))
const plainText      = computed(() => parsed().map(b => blocksToText(b)).join(' ').trim())
const hasDescription = computed(() => plainText.value.length > 0)

const open = ref(false)
const wrap = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  if (open.value && wrap.value && !wrap.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.role-label-wrap { position: relative; display: inline; }

.role-label {
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  background: none;
  border: 0;
  padding: 0;
  cursor: help;
  text-decoration: underline dotted;
  text-decoration-color: currentColor;
  text-underline-offset: 2px;
  -webkit-tap-highlight-color: transparent;
}
.role-label:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 2px; }

/* Mirrors .source-popover in SourceRef.vue. */
.role-popover {
  position: absolute;
  top: calc(100% + var(--space-xs));
  left: 0;
  z-index: 50;
  display: block;
  min-width: 240px;
  max-width: 320px;
  padding: var(--space-md);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 400;
  line-height: var(--leading-normal);
  letter-spacing: normal;
  text-transform: none;
  text-align: left;
  white-space: normal;
  color: var(--ink);
  cursor: default;
}
.role-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-xs);
}
.role-popover-kind {
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
}
.role-popover-close {
  width: 22px;
  height: 22px;
  background: none;
  border: 0;
  color: var(--muted);
  font-size: var(--size-h3);
  line-height: 1;
  cursor: pointer;
  padding: 0;
  border-radius: var(--radius-md);
}
.role-popover-close:hover { background: var(--paper-sunken); color: var(--faded-red); }
.role-popover-name {
  display: block;
  margin-bottom: var(--space-xs);
  font-weight: 600;
  color: var(--ink);
}
.role-popover-text { display: block; }
.role-popover-text :deep(p) { margin: 0 0 0.5em; }
.role-popover-text :deep(p:last-child) { margin-bottom: 0; }
.role-popover-sources { display: block; margin-top: var(--space-sm); }
.role-popover-sources :deep(.source-refs) { margin-left: 0; }
</style>
