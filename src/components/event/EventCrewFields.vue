<template>
  <div class="crew" role="group" :aria-label="`Mannskap på ${entry.targetName || 'transportmiddelet'}`">
    <span class="crew-label">Mannskap</span>
    <p v-if="!entry.crew?.length" class="crew-empty">Ingen mannskap registrert</p>
    <div v-for="(c, i) in entry.crew" :key="keyOf(c)" class="crew-row">
      <div class="crew-person">
        <span v-if="c.targetSlug" class="crew-name">{{ c.targetName || c.targetSlug }}</span>
        <template v-else>
          <input v-model="query" class="crew-input" type="text" placeholder="Søk person…" aria-label="Søk person" />
          <div v-if="matches.length" class="crew-results">
            <button v-for="p in matches" :key="p.slug" type="button" class="crew-result" @click="pick(c, p)">{{ p.name }}</button>
          </div>
        </template>
      </div>
      <select v-model="c.role" class="crew-input crew-role" aria-label="Rolle">
        <option :value="null">—</option>
        <option v-for="r in roleOptions" :key="r.key" :value="r.key">{{ r.name }}</option>
        <option v-if="c.role && !roleOptions.some(r => r.key === c.role)" :value="c.role">{{ c.role }} (ukjent)</option>
      </select>
      <MoveControl
        v-if="entry.crew!.length > 1"
        class="crew-flytt"
        :position="i + 1"
        :total="entry.crew!.length"
        :name="c.targetName || 'raden'"
        :open="moving === c"
        @toggle="moving = moving === c ? null : c"
        @close="moving = null"
        @move="to => move(i, to)"
      />
      <button type="button" class="crew-btn crew-remove" :aria-label="`Fjern ${c.targetName || 'raden'} fra mannskapet`" @click="remove(i)">Fjern</button>
    </div>
    <div class="crew-actions">
      <button type="button" class="crew-btn" @click="add">+ Legg til mannskap</button>
      <button type="button" class="crew-btn" :disabled="!date || !entry.targetSlug || busy" @click="copyRegular">Hent fast mannskap</button>
      <span class="crew-note" role="status">{{ date ? note : 'Hendelsen har ingen dato.' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The crew of one transport on an event, edited inside that transport's row.
 * It only changes `entry.crew`; the transport list saves it. «Hent fast
 * mannskap» adds the transport's regular crew on the event's date.
 */
/* eslint-disable vue/no-mutating-props */
import { computed, ref, shallowRef, toRef } from 'vue'
import MoveControl from '@/components/MoveControl.vue'
import { useRoleOptions } from '@/composables/useRoles.ts'
import { regularCrewOn } from '@/components/relation/eventCrew.ts'
import { TransportCrewStrategy } from '@/components/relation/crewStrategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'

const props = defineProps<{
  entry:   RelationEntry
  targets: RelationTarget[]
  date?:   string | null
}>()

const roleOptions = useRoleOptions(toRef(() => 'crew'))
const query = ref('')
const busy  = ref(false)
const note  = ref('')

const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? props.targets.filter(t => t.name.toLowerCase().includes(q)).slice(0, 8) : []
})

function add() {
  (props.entry.crew ??= []).push({
    targetSlug: '', targetName: '', role: null,
    startDate: null, endDate: null, sections: [], hasDescription: false,
  })
  query.value = ''
}

function pick(c: RelationEntry, p: RelationTarget) {
  c.targetSlug = p.slug
  c.targetName = p.name
  query.value = ''
}

// Rows are keyed by the object, so focus follows a row that moves.
const keys = new WeakMap<RelationEntry, number>()
let nextKey = 0
function keyOf(c: RelationEntry): number {
  let k = keys.get(c)
  if (k === undefined) keys.set(c, k = nextKey++)
  return k
}

// The panel follows its row, not its index: the row keeps the panel when it moves.
const moving = shallowRef<RelationEntry | null>(null)

function move(from: number, to: number) {
  const crew = props.entry.crew
  if (!crew || to < 0 || to >= crew.length) return
  const [row] = crew.splice(from, 1)
  crew.splice(to, 0, row)
}

function remove(i: number) {
  props.entry.crew?.splice(i, 1)
}

async function copyRegular() {
  if (!props.date) return
  busy.value = true
  note.value = ''
  try {
    const add = regularCrewOn(await TransportCrewStrategy.fetchEntries(props.entry.targetSlug), props.date, props.entry.crew ?? [])
    ;(props.entry.crew ??= []).push(...add)
    note.value = add.length ? `La til ${add.length}. Husk å lagre.` : 'Ingen flere i fast mannskap på denne datoen.'
  } catch (e) {
    note.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.crew { display: flex; flex-direction: column; gap: var(--space-sm); font-family: var(--font-sans); }
.crew-label {
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
}
.crew-empty { margin: 0; font-size: var(--size-body-ui); font-style: italic; color: var(--muted); }

.crew-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas: 'person flytt' 'role remove';
  gap: var(--space-sm);
  align-items: center;
}
.crew-person { grid-area: person; }
.crew-role   { grid-area: role; }
.crew-flytt  { grid-area: flytt; justify-self: end; padding-right: 0; }
.crew-remove { grid-area: remove; justify-self: end; }
.crew-row + .crew-row { padding-top: var(--space-sm); border-top: 1px dashed var(--rule); }
.crew-person { position: relative; min-width: 0; }
.crew-name { font-size: var(--size-body-ui); font-weight: 500; color: var(--ink); }

.crew-input {
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}
.crew-input:focus { outline: 1px solid var(--focus); outline-offset: 0; border-color: var(--focus); }
.crew-role { padding-inline: var(--space-sm); }

.crew-results {
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  margin-top: var(--space-xs);
  max-height: 240px;
  overflow-y: auto;
  background: var(--paper-raised);
}
.crew-result {
  display: block;
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  text-align: left;
  color: var(--ink);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
}
.crew-result:hover { background: var(--paper-sunken); }

.crew-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }
.crew-btn {
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
.crew-btn:hover:not(:disabled) { background: var(--paper-sunken); }
.crew-btn:disabled { color: var(--muted); cursor: default; }
.crew-remove { color: var(--danger); }
.crew-note { font-size: var(--size-label); color: var(--muted); }
</style>
