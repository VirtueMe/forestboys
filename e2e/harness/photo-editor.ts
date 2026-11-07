/**
 * The photo-editor harness (#414): the real PhotoEditor, the way an edit pane mounts it. `?rows=` sets `visibleRows`.
 */
import { createApp, defineComponent, h } from 'vue'
import PhotoEditor from '@/components/PhotoEditor.vue'
import '@/assets/main.css'

const rows = new URLSearchParams(location.search).get('rows')

createApp(defineComponent({
  setup: () => () => h('main', { style: 'max-width: 720px; margin: 0 auto; padding: 16px' }, [
    h(PhotoEditor, { kind: 'person', slug: 'harness', ...(rows ? { visibleRows: Number(rows) } : {}) }),
  ]),
})).mount('#harness')
