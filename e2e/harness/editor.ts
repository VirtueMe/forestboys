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

// `?scroller=1`: the editor inside a scroll container, as it is in the app. There the window never scrolls
// (html, body and #app are overflow: hidden) and the page is `.page-content` in App.vue, a flex child with
// `overflow-y: auto`; a scroll that reaches the end of the text box goes on to it, or not, depending on the
// box's `overscroll-behavior`. Off by default: without it the page is exactly what it always was.
const scroller = new URLSearchParams(location.search).has('scroller')

const content = ref(JSON.stringify(start))
const reports = ref(0)
const history: string[] = []

createApp(defineComponent({
  setup: () => () => {
    const page = h('main', { style: 'max-width: 720px; margin: 0 auto; padding: 16px' }, [
      h(PortableTextEditor, {
        modelValue: JSON.parse(content.value) as PortableTextBlock[],
        'onUpdate:modelValue': (blocks: PortableTextBlock[]) => { content.value = JSON.stringify(blocks); history.push(content.value); reports.value++ },
      }),
      h('pre', { 'data-testid': 'value', style: 'font-size: 11px; white-space: pre-wrap' }, content.value),
    ])
    return scroller ? h('div', { 'data-testid': 'scroller', style: 'height: 100vh; overflow-y: auto' }, [page]) : page
  },
})).mount('#harness')

window.__harness = {
  value:   () => JSON.parse(content.value) as Block[],
  reports: () => reports.value,
  history: () => history,
  set:     blocks => { content.value = JSON.stringify(blocks) },
}
