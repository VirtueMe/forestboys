/**
 * The relation-list harness (#393): the real RelationListEditor with `?n=` rows (25 by default), the way an editor page
 * mounts it, and a strategy that saves nothing. `?rows=` sets `visibleRows`.
 */
import { createApp, defineComponent, h, reactive } from 'vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import type { RelationEntry, RelationStrategy, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import '@/assets/main.css'

const params = new URLSearchParams(location.search)
const n = Number(params.get('n') ?? 25)
const rows = params.get('rows')

const entry = (i: number): RelationEntry => ({
  targetSlug: `person-${i}`, targetName: `Person ${String(i).padStart(2, '0')}`,
  startDate: null, endDate: null, sections: [], hasDescription: false,
})
const entries = reactive<RelationEntry[]>(Array.from({ length: n }, (_, i) => entry(i + 1)))
const targets: RelationTarget[] = Array.from({ length: 40 }, (_, i) => ({ slug: `person-${i + 1}`, name: `Person ${String(i + 1).padStart(2, '0')}` }))

const strategy: RelationStrategy = {
  fetchTargets: () => Promise.resolve(targets),
  fetchEntries: () => Promise.resolve(entries),
  saveEntries: () => Promise.resolve(),
  saveNote: () => Promise.resolve(),
  targetRoute: e => `/person/${e.targetSlug}`,
}

createApp(defineComponent({
  setup: () => () => h('main', { style: 'max-width: 720px; margin: 0 auto; padding: 16px' }, [
    h(RelationListEditor, {
      parentSlug: 'harness', entries, targets, strategy,
      label: 'Omtalte personer (rediger)', addLabel: '+ Legg til person', emptyLabel: 'Ingen personer knyttet',
      searchPlaceholder: 'Søk person…', pickerChipAria: 'Bytt person', validationEmpty: 'Velg person for alle oppføringer før du lagrer.',
      showDates: false, showDescription: false, reorderable: true,
      ...(rows ? { visibleRows: Number(rows) } : {}),
    }),
  ]),
})).mount('#harness')
