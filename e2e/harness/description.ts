/**
 * The description harness (#140): the real DescriptionEditor, as an admin page mounts it, with one
 * section. `?text=` is the section's text, or `?fixture=` a named content of the editor harness (e2e/harness/fixtures.ts). The PATCH goes to `/__harness/description`, which a test answers
 * with page.route; the save bar and what is sent are the real ones.
 */
import { createApp, defineComponent, h, ref } from 'vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import '@/assets/main.css'
import { fixtures } from './fixtures.ts'

const params = new URLSearchParams(location.search)
const text = params.get('text') ?? 'Første avsnitt.'
const fixture = fixtures[params.get('fixture') ?? '']

const block = {
  _key: 'p1', _type: 'block', style: 'normal', markDefs: [],
  children: [{ _key: 'p1s', _type: 'span', text, marks: [] }],
}
const saved = ref<Section[]>([{ order: 1, content: JSON.stringify(fixture ?? [block]), citations: [], sourcedFrom: null }])

createApp(defineComponent({
  setup: () => () => h('main', { style: 'max-width: 720px; margin: 0 auto; padding: 16px' }, [
    h(DescriptionEditor, {
      saved: saved.value,
      endpoint: '/__harness/description',
      onSaved: (sections: Section[]) => { saved.value = sections },
    }),
  ]),
})).mount('#harness')
