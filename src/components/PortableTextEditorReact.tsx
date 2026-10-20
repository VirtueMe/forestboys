/**
 * Thin React wrapper around @portabletext/editor. Mounted from Vue via
 * PortableTextEditor.vue — never imported directly into a .vue file.
 */

import {
  defineAnnotation,
  defineContainer,
  defineDecorator,
  defineSchema,
  defineTextBlock,
  EditorProvider,
  keyGenerator,
  PortableTextEditable,
  useEditor,
  useEditorSelector,
  type EditorSelection,
  type PortableTextBlock,
  type TextBlockRenderProps,
} from '@portabletext/editor'
import { defineBehavior, effect, execute, forward } from '@portabletext/editor/behaviors'
import { BehaviorPlugin, EventListenerPlugin, NodePlugin } from '@portabletext/editor/plugins'
import {
  getActiveAnnotations, getFocusTextBlock, getSelectedTextBlocks, getSelectedValue, getSelection, isActiveDecorator, isActiveListItem, isActiveStyle, isSelectionExpanded,
} from '@portabletext/editor/selectors'
import React from 'react'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { linkTextRange, selectionTextRange, splitMarks, type SpanPoint, type TextRange } from '@/utils/linkText.ts'
import { findNode, siblingLists, walkBlocks, type PathSegment } from '@/utils/blockTree.ts'
import { cellTexts, guessSeparator, linesOf, SEPARATORS, tableFromBlocks, type Separator, type TextBlock } from '@/utils/textTable.ts'
import { listIndexes, type ListBlock } from '@/utils/listIndex.ts'
import { hasLinkMark, resolveLinkTarget, type SanityBlock } from '@/utils/portableText.ts'
import {
  addColumn, addRow, cellAt, columnsOf, deleteColumn, deleteRow, emptyBlock, firstBlockOf, firstSpanKey, frameOf, isLastSibling, lastBlockOf, lastSpanOf, nextCell, optionEdit, widthOf,
  previousCell, rowsWithBlockIn, rowsWithRowAfter, type CellAt, type StructureEdit, type TableOption,
} from '@/utils/tableNav.ts'

const DECORATORS = ['strong', 'em', 'underline'] as const

const schemaDefinition = defineSchema({
  decorators: DECORATORS.map(name => ({ name })),
  // Headings in a description are h3 to h6: the section already has the page's h2, and h1 is
  // reserved for the text-block page title. h3 has a button, h4 to h6 a small menu (DeepHeadingMenu).
  styles: [
    { name: 'normal' },
    { name: 'h3' },
    { name: 'h4' },
    { name: 'h5' },
    { name: 'h6' },
    { name: 'blockquote' },
    // Fixed-width text kept as typed: the box the renderer draws (#260). Set here, never guessed from tabs.
    { name: 'preformatted' },
  ],
  annotations: [
    // The shape Sanity stores: `{ _type: 'link', href }`. Some stored links have no
    // href (dead links, src/utils/linkCheck.ts), so the field is optional.
    {
      name: 'link',
      fields: [
        { name: 'href', type: 'string' },
      ],
    },
    {
      name: 'person',
      fields: [
        { name: 'slug', type: 'string' },
        { name: 'name', type: 'string' },
      ],
    },
  ],
  // The stored descriptions use both (Sanity: 1,025 of 2,282 events); the page renders them
  // (blocksToHtml). Without them here the editor drew a list as plain paragraphs and could not
  // continue, indent or end one (#124).
  lists: [
    { name: 'bullet' },
    { name: 'number' },
  ],
  inlineObjects: [],
  // Containers (#308): a box holds text blocks and tables, a table is rows of cells, a cell holds text blocks. A cell
  // takes paragraphs and quotes, with the lists and marks of the root schema, and no headings: the page reads a heading
  // in a cell as a fault (src/utils/headingOutline.ts) and ingest refuses it (functions/_lib/description-blocks.ts).
  blockObjects: [
    { name: 'infoBox', fields: [{ name: 'content', type: 'array', of: [{ type: 'block' }, { type: 'table' }] }] },
    // The options of a table are fields of its own, so the editor keeps them: a field the schema does not name is dropped.
    { name: 'table',   fields: [
      { name: 'rows', type: 'array', of: [{ type: 'row' }] },
      { name: 'frame', type: 'string' }, { name: 'width', type: 'string' }, { name: 'rowLines', type: 'boolean' }, { name: 'columnLines', type: 'boolean' },
    ] },
    { name: 'row',     fields: [{ name: 'cells',   type: 'array', of: [{ type: 'cell' }] }] },
    { name: 'cell',    fields: [{ name: 'content', type: 'array', of: [{ type: 'block', styles: [{ name: 'normal' }, { name: 'blockquote' }] }] }] },
  ],
})

// How the marks, the styles and the two annotations are drawn. Registered nodes, not the render props
// of PortableTextEditable: the editor removed those in 8.0. Module-level, so the plugin registers once.
const decoratorTags = { strong: 'strong', em: 'em', underline: 'u' } as const

const styleTags: Record<string, string> = {
  h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', blockquote: 'blockquote', preformatted: 'pre',
}

function TextBlock(props: TextBlockRenderProps) {
  const { node, children, attributes, renderDefault } = props
  const editor = useEditor()
  const index  = useEditorSelector(editor, snapshot => listIndexes(snapshot.context.value as ListBlock[]).get(node._key))
  const listed = node.listItem !== undefined && node.level !== undefined
  return renderDefault({
    ...props,
    attributes: {
      ...attributes,
      ...(listed ? { 'data-list-item': node.listItem, 'data-level': node.level, 'data-list-index': index } : {}),
    },
    children: React.createElement(styleTags[node.style ?? ''] ?? 'p', null, children),
  })
}

// How the containers are drawn while editing (the CSS is in PortableTextEditor.vue): the page draws the final look (#313),
// this one shows the cells with a dotted rule so there is somewhere to put the caret. The table sits in a wrapper that
// scrolls sideways, as on the page, and takes the editor's attributes.
const cellContainer = defineContainer({
  type: 'cell', arrayField: 'content',
  render: ({ attributes, children }) => React.createElement('td', { ...attributes, className: 'pt-edit-cell' }, children),
})
const rowContainer = defineContainer({
  type: 'row', arrayField: 'cells',
  render: ({ attributes, children }) => React.createElement('tr', attributes, children),
  of: [cellContainer],
})
const tableContainer = defineContainer({
  type: 'table', arrayField: 'rows',
  // The options of the table are drawn as classes, as the page does (src/utils/portableText.ts): the frame, and the rules between rows and columns.
  render: ({ attributes, children, node }) => {
    const frame = frameOf(node)
    const classes = ['pt-edit-grid', frame === 'topBottom' && 'pt-edit-grid--topbottom', frame === 'around' && 'pt-edit-grid--around',
      widthOf(node) === 'full' && 'pt-edit-grid--full', node.rowLines === true && 'pt-edit-grid--rows', node.columnLines === true && 'pt-edit-grid--columns'].filter(Boolean).join(' ')
    return React.createElement('div', { ...attributes, className: 'pt-edit-grid-wrap' },
      React.createElement('table', { className: classes }, React.createElement('tbody', null, children)))
  },
  of: [rowContainer],
})
const boxContainer = defineContainer({
  type: 'infoBox', arrayField: 'content',
  render: ({ attributes, children }) => React.createElement('div', { ...attributes, className: 'pt-edit-box' }, children),
  of: [tableContainer],
})

const nodes = [
  tableContainer,
  boxContainer,
  ...DECORATORS.map(name => defineDecorator({
    type:   name,
    render: ({ children }) => React.createElement(decoratorTags[name], null, children),
  })),

  // A text block: its style as the element inside, and the list item's attributes on the wrapper, which the
  // CSS in PortableTextEditor.vue draws (the editor no longer puts them there once a text block is registered).
  defineTextBlock({
    type:   'block',
    render: props => React.createElement(TextBlock, props),
  }),

  defineAnnotation({
    type: 'link',
    render: ({ annotation, children }) => {
      const href = (annotation as { href?: string }).href?.trim() ?? ''
      return React.createElement(
        'a',
        {
          className: `pt-link-mark${href ? '' : ' pt-link-mark--dead'}`,
          href:      href || undefined,
          title:     href || 'Lenken har ingen adresse',
          onClick:   (e: React.MouseEvent) => e.preventDefault(),   // editing, not navigating
        },
        children,
      )
    },
  }),

  defineAnnotation({
    type: 'person',
    render: ({ annotation, children }) => {
      const v    = annotation as { slug?: string; name?: string }
      const slug = v.slug ?? ''
      const name = v.name ?? slug
      return React.createElement(
        'a',
        {
          className:   'pt-person-mark',
          'data-slug': slug,
          href:        `/person/${slug}`,
          title:       name ? `${name} (/${slug})` : `/${slug}`,
          onClick:     (e: React.MouseEvent) => e.preventDefault(),
        },
        children,
      )
    },
  }),
]

export interface Props {
  value:    PortableTextBlock[]
  /** What a screen reader says when it lands in the editor (#146). */
  label:    string
  /** Changes when the value was replaced from outside: the editor starts over with it (see PortableTextEditor.vue). */
  generation: number
  onChange: (blocks: PortableTextBlock[]) => void
  /** The editor fills the window (PortableTextEditor.vue sets the class on the host). */
  expanded:        boolean
  onToggleExpand:  () => void
  /** Hands the page a way to read what the editor holds right now, not what it last reported (#145). */
  registerReader:  (read: (() => PortableTextBlock[] | undefined) | null) => void
}

/** Renders nothing: gives `registerReader` the editor's own, synchronous snapshot of its value. */
function ValueReader({ registerReader }: Pick<Props, 'registerReader'>) {
  const editor = useEditor()
  React.useEffect(() => {
    registerReader(() => editor.getSnapshot().context.value)
    return () => registerReader(null)
  }, [editor, registerReader])
  return null
}

function ToolbarButton({
  label,
  active,
  onClick,
  title,
  ariaLabel,
  extraClass,
  disabled,
  expanded,
}: {
  label:       React.ReactNode
  active:      boolean
  onClick:     () => void
  title?:      string
  /** The name of an icon-only button, for screen readers. */
  ariaLabel?:  string
  extraClass?: string
  disabled?:   boolean
  /** For a button that opens a list: whether it is open. */
  expanded?:   boolean
}) {
  return React.createElement(
    'button',
    {
      type:      'button',
      className: `pt-tb-btn${active ? ' active' : ''}${extraClass ? ` ${extraClass}` : ''}`,
      title,
      disabled,
      'aria-label': ariaLabel,
      'aria-expanded': expanded,
      'aria-haspopup': expanded === undefined ? undefined : 'true',
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(), // keep selection
      onClick,
    },
    label,
  )
}

/** Two arrows pointing at opposite corners: the expand icon of Sanity's editor. */
const expandIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
  React.createElement('path', { d: 'M9.5 2H14v4.5M6.5 14H2V9.5M14 2 9 7M2 14l5-5' }),
)

/** Three dots and three lines: a bulleted list. */
const bulletListIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true },
  [3.5, 8, 12.5].map(y => React.createElement('circle', { key: `d${y}`, cx: 2.5, cy: y, r: 0.9, fill: 'currentColor', stroke: 'none' })),
  [3.5, 8, 12.5].map(y => React.createElement('path', { key: `l${y}`, d: `M6 ${y}h8` })),
)

/** Three numbers and three lines: a numbered list. */
const numberListIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true },
  ['1', '2', '3'].map((n, i) => React.createElement('text', { key: `n${n}`, x: 0.5, y: 5 + i * 4.5, fontSize: 4.6, fontWeight: 700, fill: 'currentColor', stroke: 'none' }, n)),
  [3.5, 8, 12.5].map(y => React.createElement('path', { key: `l${y}`, d: `M6 ${y}h8` })),
)

/** A box with two lines of text in it: the info box. */
const boxIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  React.createElement('rect', { x: 2, y: 3, width: 12, height: 10, rx: 1 }),
  React.createElement('path', { d: 'M5 7h6M5 10h4' }),
)

/** Rules above, between and below, and one rule between two columns: a table of cells with no box around it. */
const cellsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true },
  React.createElement('path', { d: 'M2 3.5h12M2 8h12M2 12.5h12M8 3.5v9' }),
)

/** Two chain links: the link icon of Sanity's editor (Feather «link»). */
const linkIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  React.createElement('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
  React.createElement('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }),
)

/**
 * Far right of the toolbar. Expanded, it reads «Ferdig» and only closes the window: saving stays
 * with the save bar behind it (DescriptionEditor), so closing never saves silently.
 */
function ExpandButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return React.createElement(ToolbarButton, {
    label:      expanded ? 'Ferdig' : expandIcon,
    active:     false,
    onClick:    onToggle,
    title:      expanded ? 'Tilbake til siden (Esc)' : 'Utvid til hele vinduet',
    ariaLabel:  expanded ? 'Ferdig' : 'Utvid',
    extraClass: 'pt-tb-expand',
  })
}

function DecoratorButton({ name, label }: { name: string; label: string }) {
  const editor = useEditor()
  const active = useEditorSelector(editor, isActiveDecorator(name))
  return React.createElement(ToolbarButton, {
    label,
    active,
    onClick: () => editor.send({ type: 'decorator.toggle', decorator: name }),
  })
}

function ListButton({ name, label, title }: { name: 'bullet' | 'number'; label: React.ReactNode; title: string }) {
  const editor = useEditor()
  const active = useEditorSelector(editor, isActiveListItem(name))
  return React.createElement(ToolbarButton, {
    label,
    active,
    title,
    ariaLabel: title,
    onClick: () => editor.send({ type: 'list item.toggle', listItem: name }),
  })
}

/**
 * The selection touches a list item. A heading cannot be shown inside a list (the page renders the
 * item as a plain <li>) and the heading check does not count it, so no heading can be made there (#144).
 */
const selectionInList = (snapshot: Parameters<typeof getSelectedTextBlocks>[0]) =>
  getSelectedTextBlocks(snapshot).some(({ node }) => !!node.listItem)

/** The containers around the text block the caret is in, outermost first; none at the top. */
const focusAncestors = (snapshot: Parameters<typeof getFocusTextBlock>[0]): readonly string[] => {
  const key = getFocusTextBlock(snapshot)?.node._key
  let found: readonly string[] = []
  if (key) walkBlocks(snapshot.context.value, (b, place) => { if (b._key === key) found = place.ancestors })
  return found
}
const caretInCell = (snapshot: Parameters<typeof getFocusTextBlock>[0]) => focusAncestors(snapshot).includes('cell')

const IN_CELL_TITLE = 'Ikke tillatt i en tabellcelle'
const IN_LIST_TITLE = 'Overskrifter kan ikke brukes i en liste'

function StyleButton({ name, label, heading, title, ariaLabel, inListTitle }: {
  name: string
  label: React.ReactNode
  heading?: boolean
  title?: string
  ariaLabel?: string
  /** For a style a list item cannot have: what the disabled button says. */
  inListTitle?: string
}) {
  const editor = useEditor()
  const active = useEditorSelector(editor, isActiveStyle(name))
  const listBlocked = useEditorSelector(editor, snapshot => (!!heading || !!inListTitle) && selectionInList(snapshot))
  // A cell takes paragraphs and quotes only (the schema): no headings, no fixed-width text.
  const cellBlocked = useEditorSelector(editor, snapshot => (!!heading || !!inListTitle) && caretInCell(snapshot))
  const blocked = listBlocked || cellBlocked
  return React.createElement(ToolbarButton, {
    label,
    active,
    disabled: blocked,
    title:    cellBlocked ? IN_CELL_TITLE : listBlocked ? (inListTitle ?? IN_LIST_TITLE) : title,
    ariaLabel,
    onClick: () => editor.send({ type: 'style.toggle', style: name }),
  })
}

const DEEP_HEADINGS = ['h4', 'h5', 'h6'] as const

/**
 * H4 to H6 behind a small ▾ beside the H3 button. The ▾ lights up when the caret is in one of
 * them; the list marks which. Esc and a click outside close it, and Esc is not passed on, so in
 * the full window it does not also close the window (PortableTextEditor.vue).
 */
function DeepHeadingMenu() {
  const editor = useEditor()
  const active = useEditorSelector(editor, snapshot => DEEP_HEADINGS.find(h => isActiveStyle(h)(snapshot)))
  const listBlocked = useEditorSelector(editor, selectionInList)
  const cellBlocked = useEditorSelector(editor, caretInCell)
  const blocked = listBlocked || cellBlocked
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => { if (blocked) setOpen(false) }, [blocked])
  const root = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return React.createElement(
    'span',
    { className: 'pt-tb-menu', ref: root },
    React.createElement(ToolbarButton, {
      label:      '▾',
      active:     !!active,
      onClick:    () => setOpen(v => !v),
      title:      cellBlocked ? IN_CELL_TITLE : listBlocked ? IN_LIST_TITLE : 'Flere overskriftsnivåer (H4–H6)',
      ariaLabel:  'Flere overskriftsnivåer',
      extraClass: 'pt-tb-more',
      disabled:   blocked,
      expanded:   open,
    }),
    open ? React.createElement(
      'div',
      { className: 'pt-menu', role: 'group', 'aria-label': 'Overskriftsnivå' },
      DEEP_HEADINGS.map(h => React.createElement(
        'button',
        {
          key:           h,
          type:          'button',
          'aria-pressed': active === h,
          className:     `pt-menu-item${active === h ? ' active' : ''}`,
          onMouseDown:   (e: React.MouseEvent) => e.preventDefault(), // keep selection
          onClick:       () => { editor.send({ type: 'style.toggle', style: h }); setOpen(false) },
        },
        h.toUpperCase(),
      )),
    ) : null,
  )
}

interface PersonHit { slug: string; name: string }

function PersonAnnotationButton() {
  const editor = useEditor()
  const [open,    setOpen]    = React.useState(false)
  const [query,   setQuery]   = React.useState('')
  const [results, setResults] = React.useState<PersonHit[]>([])

  React.useEffect(() => {
    if (!open || query.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      try {
        const rows = await neo4jQuery<PersonHit>(`
          MATCH (p:Person)
          WHERE toLower(p.canonicalName) CONTAINS toLower($q)
          RETURN p.slug AS slug, p.canonicalName AS name
          ORDER BY p.canonicalName
          LIMIT 12
        `, { q: query })
        setResults(rows)
      } catch { setResults([]) }
    }, 150)
    return () => clearTimeout(t)
  }, [open, query])

  function apply(p: PersonHit) {
    editor.send({
      type:       'annotation.toggle',
      annotation: { name: 'person', value: { slug: p.slug, name: p.name } },
    })
    setOpen(false)
    setQuery('')
    setResults([])
  }

  return React.createElement(
    'span',
    { className: 'pt-tb-person' },
    React.createElement(ToolbarButton, {
      label:  '@',
      active: open,
      onClick: () => setOpen(v => !v),
    }),
    open ? React.createElement(
      'div',
      { className: 'pt-person-pop' },
      React.createElement('input', {
        className:   'pt-person-input',
        autoFocus:   true,
        placeholder: 'Søk person…',
        value:       query,
        onChange:    (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
      }),
      results.map(r =>
        React.createElement(
          'button',
          {
            key:          r.slug,
            type:         'button',
            className:    'pt-person-result',
            onMouseDown:  (e: React.MouseEvent) => e.preventDefault(),
            onClick:      () => apply(r),
          },
          r.name,
          React.createElement('span', { className: 'pt-person-slug' }, r.slug),
        ),
      ),
    ) : null,
  )
}

/** The event `replaceWords` answers to; one name for the sender and the behavior. */
const REPLACE_WORDS = 'custom.replaceWords'

/**
 * Replaces words and types them again with their marks: select, delete, `insert.span`. The
 * editor does not carry a link mark onto typed text (at the edge of a span it goes to the
 * neighbour), and deleting and inserting as two events takes two undos. As the actions of one
 * behavior they are one undo step.
 *
 * The delete is `delete.backward` over an expanded selection, which deletes the selection:
 * the name says one character, so this leans on how @portabletext/editor 6.6.9 behaves
 * (`delete.text` with a path range removed the wrong words). Recheck it when upgrading.
 */
const replaceWords = defineBehavior<{
  at:          NonNullable<EditorSelection>
  text:        string
  decorators:  string[]
  annotations: { name: string; value: Record<string, unknown> }[]
}>({
  on: REPLACE_WORDS,
  actions: [({ event }) => [
    execute({ type: 'select', at: event.at }),
    execute({ type: 'delete.backward', unit: 'character' }),
    execute({ type: 'insert.span', text: event.text, decorators: event.decorators, annotations: event.annotations }),
  ]],
})

/**
 * A heading that becomes a list item turns back into a plain item. The page renders a list item as
 * a plain <li> whatever its style, and the heading check does not count it, so keeping the style
 * would be a heading that exists only in the data (#144). The toolbar already refuses H3 to H6 in
 * a list; this is the other way in, the list button (or a typed «- ») on a heading.
 */
const listItemIsNoHeading = defineBehavior({
  on: 'list item.add',
  guard: ({ snapshot }) => getSelectedTextBlocks(snapshot).some(({ node }) => !!node.style && node.style !== 'normal'),
  actions: [({ event }) => [forward(event), execute({ type: 'style.add', style: 'normal' })]],
})

/** A caret at the start of the first block of a cell, as a selection the editor takes. */
function cellStart(cell: CellAt, row: number, col: number, rows: unknown): NonNullable<EditorSelection> | null {
  const table = { ...cell.table, rows } as CellAt['table']
  const block = firstBlockOf(table, row, col)
  const span  = block && firstSpanKey(block)
  const r = (rows as { _key: string; cells: { _key: string }[] }[])[row]
  if (!block || !span || !r) return null
  const path: PathSegment[] = [
    ...cell.tablePath, 'rows', { _key: r._key }, 'cells', { _key: r.cells[col]._key }, 'content', { _key: block._key as string }, 'children', { _key: span },
  ]
  const point = { path, offset: 0 }
  return { anchor: point, focus: point }
}

/** Where the caret is in a table: the cell it is in, or null outside one. */
const caretCell = (snapshot: Parameters<typeof getFocusTextBlock>[0]): CellAt | null => {
  const key = getFocusTextBlock(snapshot)?.node._key
  return key ? cellAt(snapshot.context.value, key) : null
}

const plainTab = (e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }, shift: boolean) =>
  e.key === 'Tab' && e.shiftKey === shift && !e.altKey && !e.ctrlKey && !e.metaKey

/**
 * Tab in a table cell goes to the next cell, and in the last cell of the table adds a row and goes to its first cell
 * (#312). Shift+Tab goes back, and from the first cell is left to the browser, which moves focus out of the editor: a
 * keyboard user is never trapped. Outside a table Tab is the browser's, as it always was.
 */
const tabInTable = defineBehavior({
  on: 'keyboard.keydown',
  guard: ({ snapshot, event }) => plainTab(event.originEvent, false) && caretCell(snapshot) !== null,
  actions: [({ snapshot }) => {
    const at = caretCell(snapshot)!
    const to = nextCell(at.table, at.row, at.col)
    if (to) {
      const rows = rowsWithBlockIn(at.table, to.row, to.col, keyGenerator)
      const sel  = cellStart(at, to.row, to.col, rows)
      return [
        ...(rows === at.table.rows ? [] : [execute({ type: 'block.set', at: at.tablePath, props: { rows } })]),
        ...(sel ? [execute({ type: 'select', at: sel })] : []),
      ]
    }
    const { rows } = rowsWithRowAfter(at.table, at.row, keyGenerator)
    const sel = cellStart(at, at.row + 1, 0, rows)
    return [execute({ type: 'block.set', at: at.tablePath, props: { rows } }), ...(sel ? [execute({ type: 'select', at: sel })] : [])]
  }],
})

/**
 * Is the caret at the very start of the cell's first block, or the very end of its last? Backspace there would reach
 * into whatever comes before the table (it took the full stop off the paragraph above), and Delete would pull in the
 * next cell: neither is something a cell edit means, so they do nothing (#312). Inside the cell, and between its own
 * blocks, they work as they do anywhere.
 */
function caretAtCellEdge(snapshot: Parameters<typeof getFocusTextBlock>[0], edge: 'start' | 'end'): boolean {
  const at = caretCell(snapshot)
  const sel = snapshot.context.selection
  const key = getFocusTextBlock(snapshot)?.node._key
  if (!at || !sel || isSelectionExpanded(snapshot)) return false
  const block = edge === 'start' ? firstBlockOf(at.table, at.row, at.col) : lastBlockOf(at.table, at.row, at.col)
  if (!block || block._key !== key) return false
  const span = edge === 'start' ? (block.children as { _key: string }[] | undefined)?.[0] : lastSpanOf(block)
  const focusSpan = (sel.focus.path.at(-1) as { _key?: string } | undefined)?._key
  if (!span || focusSpan !== span._key) return false
  const text = (span as { text?: string }).text ?? ''
  return edge === 'start' ? sel.focus.offset === 0 : sel.focus.offset >= text.length
}

const backspaceAtCellStart = defineBehavior({
  on: 'keyboard.keydown',
  guard: ({ snapshot, event }) => event.originEvent.key === 'Backspace' && !event.originEvent.metaKey && !event.originEvent.ctrlKey && !event.originEvent.altKey && caretAtCellEdge(snapshot, 'start'),
  actions: [() => [effect(() => undefined)]],
})

const deleteAtCellEnd = defineBehavior({
  on: 'keyboard.keydown',
  guard: ({ snapshot, event }) => event.originEvent.key === 'Delete' && !event.originEvent.metaKey && !event.originEvent.ctrlKey && !event.originEvent.altKey && caretAtCellEdge(snapshot, 'end'),
  actions: [() => [effect(() => undefined)]],
})

/** The event that puts an empty paragraph after a table and the caret in it. */
const paragraphAfter = (tablePath: PathSegment[]) => {
  const point = { path: tablePath, offset: 0 }
  return { type: 'insert.block', block: newBlock(), placement: 'after', at: { anchor: point, focus: point }, select: 'start' } as never
}

/**
 * ArrowDown at the very end of the last cell of a table that is the last thing in its box (or in the text) adds an empty
 * paragraph after the table and puts the caret in it: otherwise there is nowhere to write after the table.
 */
const arrowDownOutOfTable = defineBehavior({
  on: 'keyboard.keydown',
  guard: ({ snapshot, event }) => {
    const e = event.originEvent
    if (e.key !== 'ArrowDown' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false
    const at = caretCell(snapshot)
    return !!at && nextCell(at.table, at.row, at.col) === null && caretAtCellEdge(snapshot, 'end')
      && isLastSibling(snapshot.context.value, at.table._key as string)
  },
  actions: [({ snapshot }) => {
    return [execute(paragraphAfter(caretCell(snapshot)!.tablePath))]
  }],
})

const shiftTabInTable = defineBehavior({
  on: 'keyboard.keydown',
  guard: ({ snapshot, event }) => {
    if (!plainTab(event.originEvent, true)) return false
    const at = caretCell(snapshot)
    return !!at && previousCell(at.table, at.row, at.col) !== null
  },
  actions: [({ snapshot }) => {
    const at = caretCell(snapshot)!
    const to = previousCell(at.table, at.row, at.col)!
    const rows = rowsWithBlockIn(at.table, to.row, to.col, keyGenerator)
    const sel  = cellStart(at, to.row, to.col, rows)
    return [
      ...(rows === at.table.rows ? [] : [execute({ type: 'block.set', at: at.tablePath, props: { rows } })]),
      ...(sel ? [execute({ type: 'select', at: sel })] : []),
    ]
  }],
})

/** A caret at the start of a top-level or box text block, for when a table is gone and the caret needs a home. */
function blockStart(path: PathSegment[], block: { children?: { _key: string }[] }): NonNullable<EditorSelection> | null {
  const span = block.children?.[0]?._key
  if (!span) return null
  const point = { path: [...path, 'children', { _key: span }], offset: 0 }
  return { anchor: point, focus: point }
}

/** Remove the table the caret is in. A table in a box is taken out of the box's content (the box keeps one empty paragraph if it held nothing else). */
function deleteTable(editor: ReturnType<typeof useEditor>): void {
  const snap = editor.getSnapshot()
  const at = caretCell(snap)
  if (!at) return
  const key = at.table._key as string
  const found = findNode(snap.context.value, key)
  const parent = found?.containers.at(-1)
  const parentPath = found?.path.slice(0, -2)
  const list = siblingLists(snap.context.value).find(l => l.list.some(n => n._key === key))?.list ?? []
  const i = list.findIndex(n => n._key === key)
  const near = [list[i - 1], list[i + 1]].find(n => n?._type === 'block') as { _key: string; children?: { _key: string }[] } | undefined
  if (parent?._type === 'infoBox' && parentPath) {
    const rest = list.filter(n => n._key !== key)
    editor.send({ type: 'block.set', at: parentPath, props: { content: rest.length ? rest : [emptyBlock(keyGenerator)] } })
    const first = (rest.length ? near : undefined) ?? undefined
    const sel = first && blockStart([...parentPath, 'content', { _key: first._key }], first)
    if (sel) editor.send({ type: 'select', at: sel })
    return
  }
  editor.send({ type: 'unset', at: at.tablePath })
  const sel = near && blockStart([{ _key: near._key }], near)
  if (sel) editor.send({ type: 'select', at: sel })
}

/**
 * The keys of the top-level blocks a selection spans, when there is more than the caret and a box could take them all:
 * every one a text block, none a container (a table in the selection is left for the person to move). Null otherwise.
 */
function wrappableKeys(snapshot: Parameters<typeof getFocusTextBlock>[0]): string[] | null {
  const sel = snapshot.context.selection
  if (!sel || !isSelectionExpanded(snapshot)) return null
  const top = (snapshot.context.value as { _key: string; _type: string }[])
  const at = (p: unknown[]) => top.findIndex(n => n._key === (p[0] as { _key?: string } | undefined)?._key)
  const a = at(sel.anchor.path), f = at(sel.focus.path)
  if (a === -1 || f === -1) return null
  const span = top.slice(Math.min(a, f), Math.max(a, f) + 1)
  return span.every(n => n._type === 'block') ? span.map(n => n._key) : null
}

/** Do the anchor and the focus of the selection sit in different top-level nodes? */
function spansTopLevel(snapshot: Parameters<typeof getFocusTextBlock>[0]): boolean {
  const sel = snapshot.context.selection
  const top = (p: unknown[]) => (p[0] as { _key?: string } | undefined)?._key
  return !!sel && top(sel.anchor.path) !== top(sel.focus.path)
}

/**
 * The keys of the text blocks a selection takes in, when they could become a table (#328): more than the caret, plain text
 * blocks side by side in one list (the top or a box), none in a list or a cell. Null otherwise.
 */
function convertKeys(snapshot: Parameters<typeof getFocusTextBlock>[0]): string[] | null {
  if (!isSelectionExpanded(snapshot)) return null
  const picked = getSelectedTextBlocks(snapshot)
  if (!picked.length || picked.some(({ path }) => path.some(s => s === 'rows' || s === 'cells'))) return null
  const firstKey = picked[0].node._key, lastKey = picked.at(-1)!.node._key
  const list = siblingLists(snapshot.context.value).find(l => l.list.some(n => n._key === firstKey))?.list ?? []
  const i = list.findIndex(n => n._key === firstKey), j = list.findIndex(n => n._key === lastKey)
  if (i === -1 || j === -1) return null
  const span = list.slice(Math.min(i, j), Math.max(i, j) + 1)
  return span.every(n => n._type === 'block' && !n.listItem) ? span.map(n => n._key as string) : null
}

const WRAP_BLOCKS = 'custom.wrapBlocks'
const CONVERT_TO_TABLE = 'custom.convertToTable'
const UNWRAP_BOX  = 'custom.unwrapBox'

/**
 * Put the top-level text blocks `keys` (consecutive, in order) in one new box: a box with copies of them goes in before
 * the first, and the originals go (#312). Only insert and delete, which the editor can undo: replacing the first block
 * by the box with `set` could not be undone, and left the second block twice. The copies have keys of their own, so
 * no step of an undo leaves two nodes with one key.
 */
const wrapBlocksBehavior = defineBehavior<{ keys: string[] }>({
  on: WRAP_BLOCKS,
  actions: [({ snapshot, event }) => {
    type Text = { _key: string; _type?: string; children?: { _key: string }[] }
    const top = snapshot.context.value as Text[]
    const nodes = event.keys.map(k => top.find(n => n._key === k)).filter((n): n is Text => !!n)
    if (!nodes.length || nodes.length !== event.keys.length || nodes.some(n => n._type !== 'block' || !n.children?.length)) return []
    const copies = nodes.map(n => ({ ...n, _key: keyGenerator(), children: n.children!.map(c => ({ ...c, _key: keyGenerator() })) }))
    const box = { _type: 'infoBox', _key: keyGenerator(), content: copies }
    const point = { path: [{ _key: nodes[0]._key }, 'children', { _key: nodes[0].children![0]._key }], offset: 0 }
    const sel = blockStart([{ _key: box._key }, 'content', { _key: copies[0]._key }], copies[0])
    return [
      execute({ type: 'insert.block', block: box, placement: 'before', at: { anchor: point, focus: point } } as never),
      ...event.keys.map(k => execute({ type: 'delete.block', at: [{ _key: k }] })),
      ...(sel ? [execute({ type: 'select', at: sel })] : []),
    ]
  }],
})

/**
 * Put a table made of the text blocks `keys` (side by side, in order) where they were, and take them away (#328). Only
 * insert and delete, so it is one undo step, as wrapping in a box is; the cells are copies with keys of their own.
 */
const convertToTableBehavior = defineBehavior<{ keys: string[]; sep: Separator; header: boolean }>({
  on: CONVERT_TO_TABLE,
  actions: [({ snapshot, event }) => {
    const found = event.keys.map(k => findNode(snapshot.context.value, k))
    if (!found.length || found.some(f => !f || f.node._type !== 'block' || !(f.node.children as unknown[] | undefined)?.length)) return []
    const table = tableFromBlocks(found.map(f => f!.node as TextBlock), event.sep, event.header, keyGenerator)
    if (!table) return []
    const first = found[0]!
    const point = { path: [...first.path, 'children', { _key: (first.node.children as { _key: string }[])[0]._key }], offset: 0 }
    const tablePath: PathSegment[] = [...first.path.slice(0, -1), { _key: table._key as string }]
    const sel = cellStart({ tablePath, table, row: 0, col: 0 }, 0, 0, table.rows)
    return [
      execute({ type: 'insert.block', block: table, placement: 'before', at: { anchor: point, focus: point } } as never),
      ...found.map(f => execute({ type: 'delete.block', at: f!.path } as never)),
      ...(sel ? [execute({ type: 'select', at: sel })] : []),
    ]
  }],
})

/** Take the box apart: what it held stays where the box was, in the same order, as one undo step. */
const unwrapBoxBehavior = defineBehavior<{ boxKey: string }>({
  on: UNWRAP_BOX,
  actions: [({ snapshot, event }) => {
    const box = findNode(snapshot.context.value, event.boxKey)?.node
    if (box?._type !== 'infoBox') return []
    const boxPath: PathSegment[] = [{ _key: event.boxKey }]
    const children = (box.content as { _key: string }[] | undefined) ?? []
    return [
      ...children.map(c => execute({ type: 'move.block', at: [...boxPath, 'content', { _key: c._key }], to: boxPath })),
      execute({ type: 'unset', at: boxPath }),
    ]
  }],
})

function wrapBlocks(editor: ReturnType<typeof useEditor>, keys: string[]): void {
  editor.send({ type: WRAP_BLOCKS, keys } as never)
}

function unwrapBox(editor: ReturnType<typeof useEditor>): void {
  const snap = editor.getSnapshot()
  const key = getFocusTextBlock(snap)?.node._key
  const box = (key ? findNode(snap.context.value, key) : null)?.containers[0]
  if (box?._type === 'infoBox') editor.send({ type: UNWRAP_BOX, boxKey: box._key as string } as never)
}

/** What the link box was opened on — fixed then, so a click elsewhere in the editor can't change what Enter does. */
interface LinkTarget {
  /** The selected words: the ones to link, or to take a link off. */
  at:      EditorSelection
  /** A caret, a selection or a link to change: without any of them there is nowhere to put a link. */
  linkable: boolean
  /** A caret with no link under it: the box inserts new linked words there. */
  caret:   boolean
  /** The decorators on at the caret, for the new words. */
  decorators: string[]
  /** The link the caret or selection lies wholly in, to change its address. */
  link:    { blockKey: string; markKey: string; href: string } | null
  /** Any link on the selected words, whole or in part. */
  hasLink: boolean
  /** The words the «Tekst» field shows, in the block they sit in; null when they cannot be read (across blocks). */
  words:   { blockKey: string; range: TextRange; decorators: string[]; annotations: ReturnType<typeof splitMarks>['annotations'] } | null
}

/** The span a selection point is in: `[{_key: block}, 'children', {_key: span}]`. */
function spanPoint(point: { path: unknown[]; offset: number }): SpanPoint | null {
  const key = (point.path[2] as { _key?: string } | undefined)?._key
  return key ? { spanKey: key, offset: point.offset } : null
}

/** The words the box was opened on: the link's, or the selection's when it lies in one block. */
function wordsOf(
  block: SanityBlock | undefined, linkKey: string | undefined, at: EditorSelection,
): LinkTarget['words'] {
  if (!block) return null
  if (linkKey) {
    const range = linkTextRange(block, linkKey)
    return range ? { blockKey: block._key, range, ...splitMarks(block, range.marks) } : null
  }
  const a = at && spanPoint(at.anchor)
  const f = at && spanPoint(at.focus)
  if (!a || !f || (at.anchor.path[0] as { _key?: string })._key !== block._key
      || (at.focus.path[0] as { _key?: string })._key !== block._key) return null
  const range = selectionTextRange(block, a, f)
  return range ? { blockKey: block._key, range, ...splitMarks(block, range.marks) } : null
}

/**
 * Link on the selected words: a full address, a path (`/events/…`) or a bare slug — what
 * `resolveLinkTarget()` takes. With the caret in a link the same box changes its address, and
 * «Fjern lenke» takes the link off and keeps the words. Whether an internal link leads anywhere
 * is checked when the description is saved (DescriptionEditor), as for every other link.
 */
function LinkAnnotationButton() {
  const editor    = useEditor()
  const active    = useEditorSelector(editor, getActiveAnnotations).find(a => a._type === 'link')
  const block     = useEditorSelector(editor, getFocusTextBlock)
  const expanded  = useEditorSelector(editor, isSelectionExpanded)
  const selection = useEditorSelector(editor, getSelection)
  const selected  = useEditorSelector(editor, getSelectedValue)
  // null: closed. The input takes focus, so everything below comes from when the box opened.
  const [target, setTarget] = React.useState<LinkTarget | null>(null)
  const [href, setHref]     = React.useState('')
  const [text, setText]     = React.useState('')

  function show() {
    const current = (active as { href?: string } | undefined)?.href ?? ''
    const words   = wordsOf(block?.node as SanityBlock | undefined, active?._key, selection)
    setHref(current)
    setText(words?.range.text ?? '')
    setTarget({
      at:       selection,
      linkable: !!active || !!selection,
      caret:    !active && !!selection && !expanded,
      decorators: DECORATORS.filter(d => isActiveDecorator(d)(editor.getSnapshot())),
      link:     active && block ? { blockKey: block.node._key, markKey: active._key, href: current } : null,
      hasLink:  !!active || hasLinkMark(selected),
      words,
    })
  }
  function close() { setTarget(null); setHref(''); setText('') }

  // The words can be changed when they are readable, carry one set of marks, and are not emptied.
  // At a caret there are none yet: the box asks for them.
  const showText     = !!target?.linkable && (!!target.words || target.caret)
  const textEditable = !!target?.caret || !!target?.words?.range.editable
  const textChanged  = !!target?.words && textEditable && text !== target.words.range.text
  const textValid    = !textEditable || text.length > 0

  function apply() {
    const value = href.trim()
    if (!target?.linkable || !resolveLinkTarget(value) || !textValid) return
    if (textChanged && target.words) {
      // The words are replaced and typed again with their marks, as one undo step (see
      // replaceWords). The link comes along with the address as it stands in the box.
      const { blockKey, range, decorators, annotations } = target.words
      const path = (key: string) => [{ _key: blockKey }, 'children', { _key: key }]
      const link = { name: 'link', value: { href: value } }
      editor.send({
        type: REPLACE_WORDS,
        at:   { anchor: { path: path(range.startKey), offset: range.startOffset }, focus: { path: path(range.endKey), offset: range.endOffset } },
        text,
        decorators,
        annotations: [
          ...annotations.filter(a => a.key !== target.link?.markKey).map(({ name, value: v }) => ({ name, value: v })),
          link,
        ],
      })
    } else if (target.caret && target.at) {
      editor.send({ type: 'select', at: target.at })
      editor.send({ type: 'insert.span', text, decorators: target.decorators, annotations: [{ name: 'link', value: { href: value } }] })
    } else if (target.link) {
      if (value !== target.link.href) {
        editor.send({ type: 'annotation.set', at: [{ _key: target.link.blockKey }, 'markDefs', { _key: target.link.markKey }], props: { href: value } })
      }
    } else if (target.at) {
      editor.send({ type: 'annotation.add', annotation: { name: 'link', value: { href: value } }, at: target.at })
    }
    close()
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter')  { e.preventDefault(); apply() }
    if (e.key === 'Escape') { e.preventDefault(); close() }
  }
  function remove() {
    editor.send({ type: 'annotation.remove', annotation: { name: 'link' }, ...(target?.at ? { at: target.at } : {}) })
    close()
  }

  return React.createElement(
    'span',
    { className: 'pt-tb-link' },
    React.createElement(ToolbarButton, {
      label:     linkIcon,
      title:     'Lenke',
      ariaLabel: 'Lenke',
      active: !!active || !!target,
      // Nowhere to put a link until the editor has a caret or a selection (an open box can still be closed).
      disabled: !target && !selection,
      onClick: () => (target ? close() : show()),
    }),
    target ? React.createElement(
      'div',
      { className: 'pt-link-pop' },
      showText ? React.createElement(
        'label',
        { className: 'pt-link-field' },
        React.createElement('span', { className: 'pt-link-label' }, 'Tekst'),
        React.createElement('input', {
          className: 'pt-link-input',
          autoFocus: textEditable,
          placeholder: target.caret ? 'Teksten som skal vises' : undefined,
          value:     text,
          readOnly:  !textEditable,
          title:     textEditable ? undefined : 'Teksten har ulik formatering og kan ikke endres her',
          onChange:  (e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value),
          onKeyDown: onKey,
        }),
      ) : null,
      React.createElement(
        'label',
        { className: 'pt-link-field' },
        showText ? React.createElement('span', { className: 'pt-link-label' }, 'Adresse') : null,
        React.createElement('input', {
          className:   'pt-link-input',
          autoFocus:   !showText || !textEditable,
          placeholder: 'https://… eller /events/…',
          value:       href,
          onChange:    (e: React.ChangeEvent<HTMLInputElement>) => setHref(e.target.value),
          onKeyDown:   onKey,
        }),
      ),
      React.createElement(
        'div',
        { className: 'pt-link-actions' },
        React.createElement('button', {
          type: 'button', className: 'pt-link-apply', disabled: !target.linkable || !resolveLinkTarget(href) || !textValid,
          onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onClick: apply,
        }, target.link ? 'Endre' : target.caret ? 'Sett inn' : 'Bruk'),
        target.hasLink ? React.createElement('button', {
          type: 'button', className: 'pt-link-remove',
          onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onClick: remove,
        }, 'Fjern lenke') : null,
      ),
    ) : null,
  )
}

const newBlock = () => ({ _type: 'block', _key: keyGenerator(), style: 'normal', markDefs: [], children: [{ _type: 'span', _key: keyGenerator(), text: '', marks: [] }] })
const newCell  = () => ({ _type: 'cell', _key: keyGenerator(), content: [newBlock()] })
/** A table of two rows and two columns, each cell with an empty paragraph: rows and columns are added from there. */
const newTable = () => ({ _type: 'table', _key: keyGenerator(), rows: [0, 1].map(() => ({ _type: 'row', _key: keyGenerator(), cells: [newCell(), newCell()] })) })
const newBox   = () => ({ _type: 'infoBox', _key: keyGenerator(), content: [newBlock()] })

/**
 * Insert a box or a table after the block the caret is in, and put the caret in it (#312). A box goes at the top only
 * (it holds blocks and tables, not another box); a table goes at the top or in a box, never in a cell. The buttons say
 * why they are off, so the click is not silently refused by the schema.
 */
function ContainerButtons() {
  const editor    = useEditor()
  const ancestors = useEditorSelector(editor, focusAncestors)
  const noFocus   = useEditorSelector(editor, snapshot => !getFocusTextBlock(snapshot))
  const wrapKeys  = useEditorSelector(editor, snapshot => (wrappableKeys(snapshot) ?? []).join(','))
  const expanded  = useEditorSelector(editor, isSelectionExpanded)
  const crossTop  = useEditorSelector(editor, spansTopLevel)
  const inBox     = ancestors[0] === 'infoBox' && !ancestors.includes('cell') && !crossTop
  const unfit     = expanded && !wrapKeys && !inBox      // more than the caret, and not something a box can take
  const boxOff    = noFocus || ancestors.includes('cell') || unfit
  const tableOff  = noFocus || ancestors.includes('cell')
  const insert = (block: object) => editor.send({ type: 'insert.block', block, placement: 'after', select: 'start' } as never)
  return React.createElement(
    React.Fragment, null,
    React.createElement(ToolbarButton, {
      label: boxIcon, active: inBox, disabled: boxOff, ariaLabel: 'Infoboks',
      title: noFocus ? 'Sett markøren i teksten først'
        : ancestors.includes('cell') ? 'En infoboks kan ikke ligge i en tabellcelle'
        : unfit ? 'Det merkede kan ikke settes i en infoboks'
        : inBox ? 'Løs opp infoboksen: innholdet blir stående'
        : wrapKeys ? 'Sett det merkede i en infoboks' : 'Infoboks',
      onClick: () => (inBox ? unwrapBox(editor) : wrapKeys ? wrapBlocks(editor, wrapKeys.split(',')) : insert(newBox())),
    }),
    // The table and its tools are one split button: the ▾ is on only with the caret in a table.
    React.createElement('span', { className: 'pt-tb-split' },
      React.createElement(ToolbarButton, {
        label: cellsIcon, active: false, disabled: tableOff, ariaLabel: 'Tabell med celler',
        title: noFocus ? 'Sett markøren i teksten først' : tableOff ? 'En tabell kan ikke ligge i en tabellcelle' : 'Tabell med celler',
        onClick: () => {
          // A table that ends up last gets an empty paragraph after it, so there is somewhere to write below it.
          const key = getFocusTextBlock(editor.getSnapshot())?.node._key
          if (key && isLastSibling(editor.getSnapshot().context.value, key)) {
            editor.send({ type: 'insert.block', block: newBlock(), placement: 'after', select: 'none' } as never)
          }
          insert(newTable())
        },
      }),
      React.createElement(TablePanel),
    ),
  )
}

/**
 * The tools of the table the caret is in: add a row above or below, a column before or after, delete the row, the
 * column or the table (#312). Each is one change to the table's `rows`, so it is one undo step. A table keeps at least
 * one row and one column: the delete buttons are off for the last of them, and «Slett tabell» is there for the rest.
 */
function TablePanel() {
  const editor  = useEditor()
  const inTable = useEditorSelector(editor, snapshot => caretCell(snapshot) !== null)
  const convKeys = useEditorSelector(editor, snapshot => (convertKeys(snapshot) ?? []).join(','))
  const canConvert = !inTable && convKeys !== ''
  const enabled = inTable || canConvert
  const [pickedSep, setPickedSep] = React.useState<Separator | null>(null)
  const [header, setHeader] = React.useState(false)
  const rowCount = useEditorSelector(editor, snapshot => (caretCell(snapshot)?.table.rows as unknown[] | undefined)?.length ?? 0)
  const colCount = useEditorSelector(editor, snapshot => { const t = caretCell(snapshot)?.table; return t ? columnsOf(t) : 0 })
  const frame       = useEditorSelector(editor, snapshot => { const t = caretCell(snapshot)?.table; return t ? frameOf(t) : 'none' })
  const width       = useEditorSelector(editor, snapshot => { const t = caretCell(snapshot)?.table; return t ? widthOf(t) : 'compact' })
  const rowLines    = useEditorSelector(editor, snapshot => caretCell(snapshot)?.table.rowLines === true)
  const columnLines = useEditorSelector(editor, snapshot => caretCell(snapshot)?.table.columnLines === true)
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => { if (!enabled) setOpen(false) }, [enabled])
  React.useEffect(() => { if (!open) { setPickedSep(null); setHeader(false) } }, [open])
  const root = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  /** Apply one edit to the caret's table; the caret goes where the edit says, or stays. The panel stays open for the next. */
  const run = (make: (at: CellAt) => StructureEdit | null) => {
    const at = caretCell(editor.getSnapshot())
    const edit = at && make(at)
    if (!at || !edit) return
    editor.send({ type: 'block.set', at: at.tablePath, props: { rows: edit.rows } })
    const sel = edit.select && cellStart(at, edit.select.row, edit.select.col, edit.rows)
    if (sel) editor.send({ type: 'select', at: sel })
  }

  /** Change one option of the caret's table: one change to its fields, so one undo step. The panel stays open for the next. */
  const setOption = (change: TableOption) => {
    const at = caretCell(editor.getSnapshot())
    if (!at) return
    const { set, unset } = optionEdit(change)
    if (Object.keys(set).length) editor.send({ type: 'block.set', at: at.tablePath, props: set })
    if (unset.length) editor.send({ type: 'block.unset', at: at.tablePath, props: unset })
  }

  const item = (label: string, aria: string, onClick: () => void, disabled = false, pressed?: boolean) => React.createElement(
    'button',
    {
      type: 'button', className: `pt-menu-item${pressed ? ' active' : ''}`, disabled, 'aria-label': aria, 'aria-pressed': pressed,
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),   // keep the selection
      onClick,
    },
    label,
  )
  const group = (title: string, ...items: React.ReactElement[]) => React.createElement(
    'div', { className: 'pt-panel-group', key: title },
    React.createElement('span', { className: 'pt-panel-title' }, title),
    React.createElement('div', { className: 'pt-panel-row' }, ...items),
  )

  // The lines to turn into a table (#328): the separator is guessed from them, and the person can switch it.
  const source = open && canConvert
    ? convKeys.split(',').map(k => findNode(editor.getSnapshot().context.value, k)?.node).filter((b): b is TextBlock => !!b)
    : []
  const sep: Separator = pickedSep ?? guessSeparator(linesOf(source)) ?? 'tab'
  const preview = source.length ? tableFromBlocks(source, sep, header, keyGenerator) : null
  const previewRows = preview ? cellTexts(preview) : []
  const columns = Math.max(0, ...previewRows.map(r => r.length))
  const SEPARATOR_LABELS: Record<Separator, string> = { tab: 'Tabulator', spaces: '2+ mellomrom', semicolon: 'Semikolon', pipe: 'Loddrett strek' }
  const convertPanel = open && canConvert ? React.createElement(
    'div',
    { className: 'pt-menu pt-table-panel', role: 'group', 'aria-label': 'Gjør om til tabell' },
    group('Skilletegn', ...SEPARATORS.map(s => item(SEPARATOR_LABELS[s], `Skilletegn ${SEPARATOR_LABELS[s].toLowerCase()}`, () => setPickedSep(s), false, sep === s))),
    group('Overskrift', item('Første linje', 'Første linje er overskrift', () => setHeader(h => !h), false, header)),
    React.createElement(
      'div', { className: 'pt-panel-group', key: 'preview' },
      React.createElement('span', { className: 'pt-panel-title' }, preview ? `${previewRows.length} rader × ${columns} kolonner` : 'Ingen tekst å lage tabell av'),
      preview ? React.createElement(
        'table', { className: 'pt-conv-preview', 'aria-label': 'Forhåndsvisning' },
        React.createElement('tbody', null, previewRows.slice(0, 4).map((row, i) => React.createElement(
          'tr', { key: i }, row.map((text, j) => React.createElement(i === 0 && header ? 'th' : 'td', { key: j }, text)),
        ))),
      ) : null,
    ),
    group('Tabell', item('Gjør om til tabell', 'Gjør om til tabell', () => {
      if (preview) editor.send({ type: CONVERT_TO_TABLE, keys: convKeys.split(','), sep, header } as never)
      setOpen(false)
    }, !preview)),
  ) : null

  return React.createElement(
    'span',
    { className: 'pt-tb-menu', ref: root },
    React.createElement(ToolbarButton, {
      label: '▾', extraClass: 'pt-tb-more',
      active: open, disabled: !enabled, expanded: open, ariaLabel: 'Tabellverktøy',
      title: inTable ? 'Rader, kolonner og sletting'
        : canConvert ? 'Gjør de merkede linjene om til en tabell'
        : 'Sett markøren i en tabellcelle for å bruke tabellverktøyene, eller merk linjer som skal bli en tabell',
      onClick: () => setOpen(v => !v),
    }),
    open && canConvert ? convertPanel : null,
    open && inTable ? React.createElement(
      'div',
      { className: 'pt-menu pt-table-panel', role: 'group', 'aria-label': 'Tabellverktøy' },
      group('Rad',
        item('Over', 'Ny rad over', () => run(at => addRow(at.table, at.row, 'above', keyGenerator))),
        item('Under', 'Ny rad under', () => run(at => addRow(at.table, at.row, 'below', keyGenerator))),
        item('Slett', 'Slett rad', () => run(at => deleteRow(at.table, at.row, at.col)), rowCount < 2)),
      group('Kolonne',
        item('Før', 'Ny kolonne før', () => run(at => addColumn(at.table, at.col, 'before', keyGenerator))),
        item('Etter', 'Ny kolonne etter', () => run(at => addColumn(at.table, at.col, 'after', keyGenerator))),
        item('Slett', 'Slett kolonne', () => run(at => deleteColumn(at.table, at.col, at.row)), colCount < 2)),
      group('Ramme',
        item('Ingen', 'Ingen ramme', () => setOption({ frame: 'none' }), false, frame === 'none'),
        item('Topp og bunn', 'Ramme topp og bunn', () => setOption({ frame: 'topBottom' }), false, frame === 'topBottom'),
        item('Rundt', 'Ramme rundt', () => setOption({ frame: 'around' }), false, frame === 'around')),
      group('Bredde',
        item('Kompakt', 'Bredde kompakt', () => setOption({ width: 'compact' }), false, width === 'compact'),
        item('Full bredde', 'Bredde full', () => setOption({ width: 'full' }), false, width === 'full')),
      group('Linjer',
        item('Mellom rader', 'Linjer mellom rader', () => setOption({ rowLines: !rowLines }), false, rowLines),
        item('Mellom kolonner', 'Linjer mellom kolonner', () => setOption({ columnLines: !columnLines }), false, columnLines)),
      group('Tabell',
        item('Avsnitt etter', 'Nytt avsnitt etter tabellen', () => {
          const at = caretCell(editor.getSnapshot())
          if (at) editor.send(paragraphAfter(at.tablePath))
          setOpen(false)
        }),
        item('Slett tabell', 'Slett tabell', () => { deleteTable(editor); setOpen(false) })),
    ) : null,
  )
}

function Toolbar({ expanded, onToggleExpand }: { expanded: boolean; onToggleExpand: () => void }) {
  return React.createElement(
    'div',
    { className: 'pt-toolbar' },
    React.createElement(StyleButton,     { name: 'normal',     label: 'P' }),
    // H3 and the ▾ with H4 to H6 are one control: a split button.
    React.createElement('span', { className: 'pt-tb-split' },
      React.createElement(StyleButton, { name: 'h3', label: 'H3', heading: true }),
      React.createElement(DeepHeadingMenu),
    ),
    React.createElement(StyleButton,     { name: 'blockquote', label: '❝' }),
    React.createElement(ContainerButtons),
    React.createElement('span',          { className: 'pt-tb-sep' }),
    React.createElement(DecoratorButton, { name: 'strong',    label: 'B' }),
    React.createElement(DecoratorButton, { name: 'em',        label: 'I' }),
    React.createElement(DecoratorButton, { name: 'underline', label: 'U' }),
    React.createElement('span',          { className: 'pt-tb-sep' }),
    React.createElement(ListButton,      { name: 'bullet', label: bulletListIcon, title: 'Punktliste' }),
    React.createElement(ListButton,      { name: 'number', label: numberListIcon, title: 'Nummerert liste' }),
    React.createElement('span',          { className: 'pt-tb-sep' }),
    React.createElement(PersonAnnotationButton),
    React.createElement(LinkAnnotationButton),
    React.createElement(ExpandButton, { expanded, onToggle: onToggleExpand }),
  )
}

export function PortableTextEditorReact({ value, label, generation, onChange, expanded, onToggleExpand, registerReader }: Props) {
  return React.createElement(
    EditorProvider,
    { key: generation, initialConfig: { schemaDefinition, initialValue: value } },
    React.createElement(EventListenerPlugin, {
      on: (event: { type: string; value?: PortableTextBlock[] }) => {
        if (event.type === 'mutation' && event.value) onChange(event.value)
      },
    }),
    React.createElement(ValueReader, { registerReader }),
    React.createElement(NodePlugin, { nodes }),
    React.createElement(BehaviorPlugin, { behaviors: [replaceWords, listItemIsNoHeading, tabInTable, shiftTabInTable, arrowDownOutOfTable, backspaceAtCellStart, deleteAtCellEnd, wrapBlocksBehavior, unwrapBoxBehavior, convertToTableBehavior] }),
    React.createElement(Toolbar, { expanded, onToggleExpand }),
    React.createElement(PortableTextEditable, {
      'aria-label': label,
      className: 'pt-editable',
    }),
  )
}
