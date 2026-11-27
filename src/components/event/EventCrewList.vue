<template>
  <ul v-if="rows.length" class="crew">
    <li v-for="(c, i) in rows" :key="i">
      <RouterLink :to="`/person/${c.targetSlug}`" class="crew-name">{{ c.targetName }}</RouterLink>
      <span v-if="c.role" class="crew-role">{{ roles.get(c.role)?.name ?? c.role }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
/** The crew of one transport on an event, under the transport's name. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useRoles } from '@/composables/useRoles.ts'
import type { RelationEntry } from '@/components/relation/RelationStrategy.ts'

const props = defineProps<{ entries: RelationEntry[] }>()

const { roles } = useRoles()
// The editor shares these entries: a row still without a person is not shown.
const rows = computed(() => props.entries.filter(e => e.targetSlug))
</script>

<style scoped>
.crew {
  list-style: none;
  margin: 0 0 var(--space-sm);
  padding: 0 0 0 var(--space-md);
  font-size: 13px;
}
.crew li { padding: 2px 0; }
.crew-name { color: var(--focus); text-decoration: none; }
.crew-name:hover { text-decoration: underline; }
.crew-role { margin-left: var(--space-sm); color: var(--muted); }
</style>
