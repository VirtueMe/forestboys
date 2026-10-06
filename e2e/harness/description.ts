/**
 * The description harness (#140): the real DescriptionEditor, as an admin page mounts it, with one
 * section. `?text=` is the section's text. The PATCH goes to `/__harness/description`, which a test answers
 * with page.route; the save bar and what is sent are the real ones.
 */
import { createApp, defineComponent, h, ref } from 'vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import '@/assets/main.css'

const text = new URLSearchParams(location.search).get('text') ?? 'Første avsnitt.'

const block = {
  _key: 'p1', _type: 'block', style: 'normal', markDefs: [],
  children: [{ _key: 'p1s', _type: 'span', text, marks: [] }],
}
const saved = ref<Section[]>([{ order: 1, content: JSON.stringify([block]), citations: [], sourcedFrom: null }])

createApp(defineComponent({
  setup: () => () => h('main', { style: 'max-width: 720px; margin: 0 auto; padding: 16px' }, [
    h(DescriptionEditor, {
      saved: saved.value,
      endpoint: '/__harness/description',
      onSaved: (sections: Section[]) => { saved.value = sections },
    }),
  ]),
})).mount('#harness')
