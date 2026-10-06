/**
 * The editor harness (#129): the real PortableTextEditor.vue, a fixture, and a handle for tests.
 * It keeps the content as a JSON string, the way SectionsEditor does, so the wrapper's «started over
 * from outside» logic (#133) gets the same data flow as on the real page.
 */
import { createApp, defineComponent, h, ref } from 'vue'
import type { PortableTextBlock } from '@portabletext/editor'
import PortableTextEditor from '@/components/PortableTextEditor.vue'
import '@/assets/main.css'
import { fixtures } from './fixtures.ts'
import type { Block, Harness } from './types.ts'

declare global {
  interface Window { __harness: Harness }
}

const name = new URLSearchParams(location.search).get('fixture') ?? 'empty'
const start = fixtures[name]
if (!start) throw new Error(`No fixture «${name}». Known: ${Object.keys(fixtures).join(', ')}`)

const content = ref(JSON.stringify(start))
const reports = ref(0)
const history: string[] = []

createApp(defineComponent({
  setup: () => () => h('main', { style: 'max-width: 720px; margin: 0 auto; padding: 16px' }, [
    h(PortableTextEditor, {
      modelValue: JSON.parse(content.value) as PortableTextBlock[],
      'onUpdate:modelValue': (blocks: PortableTextBlock[]) => { content.value = JSON.stringify(blocks); history.push(content.value); reports.value++ },
    }),
    h('pre', { 'data-testid': 'value', style: 'font-size: 11px; white-space: pre-wrap' }, content.value),
  ]),
})).mount('#harness')

window.__harness = {
  value:   () => JSON.parse(content.value) as Block[],
  reports: () => reports.value,
  history: () => history,
  set:     blocks => { content.value = JSON.stringify(blocks) },
}
